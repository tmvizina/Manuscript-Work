import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { registerIpcHandlers } from "./ipc.js";
import { getUiRoot, getUserDataPaths } from "./paths.js";
import { createUiUrl, isAllowedUiUrl, registerUiProtocol, registerUiScheme } from "./uiProtocol.js";

const DEV_URL_ENV = ["BOOK_WRITER_DEV_URL", "ELECTRON_RENDERER_URL", "VITE_DEV_SERVER_URL"] as const;

let mainWindow: BrowserWindow | null = null;
let rendererOrigin: string | undefined;
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

function configureUserDataPaths(): void {
  const paths = getUserDataPaths(app.getPath("userData"));
  mkdirSync(paths.logs, { recursive: true });
  mkdirSync(paths.data, { recursive: true });
  mkdirSync(paths.projects, { recursive: true });
  app.setAppLogsPath(paths.logs);
  console.info(`[desktop] userData=${paths.userData}`);
  console.info(`[desktop] logs=${paths.logs}`);
  console.info(`[desktop] data=${paths.data}`);
  console.info(`[desktop] projects=${paths.projects}`);
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

export async function createMainWindow(): Promise<BrowserWindow> {
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

  installNavigationGuards(window);
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
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
      configureUserDataPaths();
      // Intentionally a no-op today; future IPC channels register here.
      registerIpcHandlers();
      await createMainWindow();
    })
    .catch((error: unknown) => {
      console.error("[desktop] application startup failed", error);
      app.quit();
    });

  app.on("activate", () => {
    if (!mainWindow) void createMainWindow();
    else mainWindow.show();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
