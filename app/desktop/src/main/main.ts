import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain } from "electron";
import { registerIpcHandlers } from "./ipc.js";
import { getUiRoot, getUserDataPaths, type DesktopUserDataPaths } from "./paths.js";
import { NativeDesktopRuntime } from "./runtime.js";
import { PROJECT_SETTING_KEYS } from "../shared/contracts.js";
import { createUiUrl, isAllowedUiUrl, registerUiProtocol, registerUiScheme } from "./uiProtocol.js";

const DEV_URL_ENV = ["BOOK_WRITER_DEV_URL", "ELECTRON_RENDERER_URL", "VITE_DEV_SERVER_URL"] as const;

let mainWindow: BrowserWindow | null = null;
let rendererOrigin: string | undefined;
let desktopRuntime: NativeDesktopRuntime | null = null;
let shutdownStarted = false;
const mainDirectory = dirname(fileURLToPath(import.meta.url));

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
  mkdirSync(paths.projects, { recursive: true });
  app.setAppLogsPath(paths.logs);
  console.info(`[desktop] userData=${paths.userData}`);
  console.info(`[desktop] logs=${paths.logs}`);
  console.info(`[desktop] data=${paths.data}`);
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

  const disposeIpc = registerIpcHandlers({
    ipcMain,
    webContents: window.webContents,
    runtime,
    isAllowedFrameUrl: (url) => isAllowedUiUrl(url, rendererOrigin),
    allowedSettingKeys: new Set(PROJECT_SETTING_KEYS),
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
      desktopRuntime = new NativeDesktopRuntime(join(paths.data, "book-writer.db"));
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
