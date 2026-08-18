import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { installCrashGuards } from "./crashGuards.js";
import { registerIpcHandlers } from "./ipc.js";
import { getUiRoot, getUserDataPaths, type DesktopUserDataPaths } from "./paths.js";
import { NativeDesktopRuntime } from "./runtime.js";
import { PROJECT_SETTING_KEYS } from "../shared/contracts.js";
import { createUiUrl, isAllowedUiUrl, registerUiProtocol, registerUiScheme } from "./uiProtocol.js";
import type { ExecutionProvider } from "../shared/contracts.js";
import { ProviderInstallation } from "./providers/installation.js";
import { installRagModelWeights } from "./rag/modelInstall.js";

const DEV_URL_ENV = ["BOOK_WRITER_DEV_URL", "ELECTRON_RENDERER_URL", "VITE_DEV_SERVER_URL"] as const;

/** Upper bound on a crash shutdown, after which the process exits regardless. */
const SHUTDOWN_GRACE_MS = 2_000;

let mainWindow: BrowserWindow | null = null;
let rendererOrigin: string | undefined;
let desktopRuntime: NativeDesktopRuntime | null = null;
let shutdownStarted = false;
const mainDirectory = dirname(fileURLToPath(import.meta.url));

// Replace Electron's default uncaught-exception dialog with a logged,
// bounded shutdown. Unattended launches (automated benchmarking, CI, a
// machine with no interactive session) never dismiss that dialog: the main
// process hangs indefinitely while already-spawned renderer/GPU/utility
// helper processes keep running, and an external harness that eventually
// force-kills the hung process can still miss anything spawned or
// reparented after its last process-tree snapshot. See crashGuards.ts.
installCrashGuards({
  log: (label, error) => console.error(`[desktop] ${label}`, error),
  shutdown: () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    try {
      for (const window of BrowserWindow.getAllWindows()) {
        try {
          window.destroy();
        } catch {
          // Best effort: the window may already be closing.
        }
      }
    } catch {
      // BrowserWindow may be unusable this early or this late in shutdown.
    }
    const runtime = desktopRuntime;
    desktopRuntime = null;

    // app.exit() terminates immediately without waiting for further event-loop
    // turns or emitting further quit-lifecycle events, unlike app.quit(). If
    // the app never reached readiness, app.exit is not usable yet, so fall
    // back to a direct process exit.
    let exited = false;
    const exitNow = () => {
      if (exited) return;
      exited = true;
      if (app.isReady()) app.exit(1);
      else process.exit(1);
    };

    // Closing the runtime is best effort and must be bounded. The process is
    // already broken, so a close() that never settles would leave it alive and
    // reintroduce exactly the unattended hang the crash guards exist to
    // prevent. Exit regardless once the grace period elapses.
    const watchdog = setTimeout(exitNow, SHUTDOWN_GRACE_MS);
    Promise.resolve(runtime?.close())
      .catch(() => {
        // Already crashing; nothing more useful to do with a close failure.
      })
      .finally(() => {
        clearTimeout(watchdog);
        exitNow();
      });
  },
});

// Electron requires privileged schemes to be registered before app.ready.
registerUiScheme();

function localDevUrl(): string | null {
  for (const key of DEV_URL_ENV) {
    const raw = process.env[key];
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if ((url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
        return url.toString();
      }
    } catch {
      console.warn(`[desktop] ignoring invalid renderer URL from ${key}`);
    }
  }
  return null;
}

function configureUserDataPaths(): DesktopUserDataPaths {
  const paths = getUserDataPaths(app.getPath("userData"));
  mkdirSync(paths.logs, { recursive: true });
  mkdirSync(paths.data, { recursive: true });
  mkdirSync(paths.backups, { recursive: true });
  mkdirSync(paths.projects, { recursive: true });
  app.setAppLogsPath(paths.logs);
  console.info(`[desktop] userData=${paths.userData}`);
  console.info(`[desktop] logs=${paths.logs}`);
  console.info(`[desktop] data=${paths.data}`);
  console.info(`[desktop] backups=${paths.backups}`);
  console.info(`[desktop] projects=${paths.projects}`);
  return paths;
}

function installNavigationGuards(window: BrowserWindow): void {
  const guard = (event: Electron.Event, url: string): void => {
    if (isAllowedUiUrl(url, rendererOrigin)) return;
    event.preventDefault();
    console.warn(`[desktop] blocked renderer navigation: ${url}`);
  };

  window.webContents.on("will-navigate", guard);
  window.webContents.on("will-redirect", guard);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedUiUrl(url, rendererOrigin)) console.warn(`[desktop] blocked renderer window-open: ${url}`);
    return { action: "deny" };
  });
  window.webContents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
}

async function loadRenderer(window: BrowserWindow, uiRoot: string): Promise<void> {
  // A packaged build must never grant the preload bridge to content selected
  // through a mutable development environment variable.
  const devUrl = app.isPackaged ? null : localDevUrl();
  if (devUrl) {
    rendererOrigin = new URL(devUrl).origin;
    await window.loadURL(devUrl);
    return;
  }

  const indexPath = join(uiRoot, "index.html");
  if (!existsSync(indexPath)) {
    console.error(`[desktop] built UI not found at ${indexPath}; run the UI build first`);
    return;
  }

  rendererOrigin = `book-writer://app`;
  registerUiProtocol(uiRoot);
  await window.loadURL(createUiUrl());
}

export async function createMainWindow(runtime: NativeDesktopRuntime): Promise<BrowserWindow> {
  const uiRoot = getUiRoot({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    developmentUiRoot: process.env.BOOK_WRITER_UI_ROOT,
  });

  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: join(mainDirectory, "..", "preload", "index.cjs"),
    },
  });

  const providerInstallation = new ProviderInstallation({
    confirmOnline: async (provider, page) => {
      const confirmation = await dialog.showMessageBox(window, {
        type: "info",
        buttons: ["Open official instructions", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: `Install ${provider === "claude" ? "Claude CLI" : "Codex CLI"}`,
        message: "Open the provider's official installation instructions?",
        detail: `${page}\n\nBook Writer will not download or run scripts. Authentication and hosted model use require network access.`,
      });
      return confirmation.response === 0;
    },
    chooseLocal: async (provider) => {
      const selection = await dialog.showOpenDialog(window, {
      title: `Choose a local ${provider === "claude" ? "Claude CLI" : "Codex CLI"} installer`,
      buttonLabel: "Review installer",
      properties: ["openFile"],
      filters: [{ name: "Windows installers", extensions: ["exe", "msi"] }],
    });
      return selection.canceled ? null : selection.filePaths[0] ?? null;
    },
    chooseExecutable: async (provider) => {
      const selection = await dialog.showOpenDialog(window, {
        title: `Choose an installed ${provider === "claude" ? "Claude CLI" : "Codex CLI"} executable`,
        buttonLabel: "Use executable",
        properties: ["openFile"],
        filters: [{ name: "Provider executables", extensions: ["exe", "cmd", "bat"] }],
      });
      return selection.canceled ? null : selection.filePaths[0] ?? null;
    },
    selectExecutable: (provider, path) => runtime.selectProviderExecutable(provider, path),
    confirmLocal: async (provider, installerPath) => {
      const confirmation = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: ["Launch installer", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      title: "Review local installer",
      message: `Launch the selected ${provider === "claude" ? "Claude CLI" : "Codex CLI"} installer?`,
      detail: `${installerPath}\n\nThis file was selected from your computer and is not verified by Book Writer. It may request privileges. Verify its publisher in Windows before continuing.`,
    });
      return confirmation.response === 0;
    },
    openExternal: (page) => shell.openExternal(page),
    openPath: (path) => shell.openPath(path),
  });

  const disposeIpc = registerIpcHandlers({
    ipcMain,
    webContents: window.webContents,
    runtime,
    isAllowedFrameUrl: (url) => isAllowedUiUrl(url, rendererOrigin),
    allowedSettingKeys: new Set(PROJECT_SETTING_KEYS),
    pickProjectRoot: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: "Choose a manuscript project folder",
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    installProvider: (provider, source) => providerInstallation.install(provider, source),
    installRagModel: () => installRagModelWeights({
      resourcesPath: process.resourcesPath,
      userDataModelDir: runtime.ragModelUserDir(),
      // The dialog runs here, so the renderer never names a path; the chosen
      // file is still hash-checked against the manifest inside the app.
      pickFile: async () => {
        const selection = await dialog.showOpenDialog(window, {
          title: "Choose the Book Writer model file",
          buttonLabel: "Install",
          properties: ["openFile"],
          filters: [{ name: "Model weights", extensions: ["onnx"] }],
        });
        return selection.canceled || selection.filePaths.length !== 1 ? null : selection.filePaths[0];
      },
    }),
  });
  installNavigationGuards(window);
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    disposeIpc();
    if (mainWindow === window) mainWindow = null;
  });

  mainWindow = window;
  try {
    await loadRenderer(window, uiRoot);
  } catch (error) {
    console.error("[desktop] renderer failed to load", error);
  }
  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady()
    .then(async () => {
      const paths = configureUserDataPaths();
      desktopRuntime = new NativeDesktopRuntime(join(paths.data, "book-writer.db"), {
        databaseBackupDirectory: paths.backups,
        userDataRoot: paths.userData,
      });
      await createMainWindow(desktopRuntime);
    })
    .catch((error: unknown) => {
      console.error("[desktop] application startup failed", error);
      app.quit();
    });

  app.on("activate", () => {
    if (!mainWindow) {
      if (desktopRuntime) void createMainWindow(desktopRuntime);
      return;
    }
    mainWindow.show();
  });

  app.on("before-quit", (event) => {
    if (!desktopRuntime || shutdownStarted) return;
    event.preventDefault();
    shutdownStarted = true;
    const runtime = desktopRuntime;
    void runtime.close()
      .catch((error: unknown) => console.error("[desktop] runtime shutdown failed", error))
      .finally(() => {
        desktopRuntime = null;
        app.quit();
      });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
