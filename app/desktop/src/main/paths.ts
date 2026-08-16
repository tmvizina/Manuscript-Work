import { join, relative, resolve, sep } from "node:path";
import { existsSync } from "node:fs";

export interface DesktopUserDataPaths {
  userData: string;
  logs: string;
  data: string;
  projects: string;
}

export interface UiRootOptions {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
  developmentUiRoot?: string;
}

/** Resolve a user-data layout without relying on a working directory. */
export function getUserDataPaths(userData: string): DesktopUserDataPaths {
  const root = resolve(userData);
  return {
    userData: root,
    logs: join(root, "logs"),
    data: join(root, "data"),
    projects: join(root, "projects"),
  };
}

/**
 * Resolve the UI root for both unpackaged development and an installed build.
 * electron-builder places `extraResources: ../ui/dist` at resources/ui.
 */
export function getUiRoot(options: UiRootOptions): string {
  if (options.isPackaged) return resolve(options.resourcesPath, "ui");
  if (options.developmentUiRoot) return resolve(options.developmentUiRoot);

  // Electron's appPath is normally app/desktop while running the compiled
  // shell. Keep the root-package layout as a fallback for IDE launchers that
  // set appPath to the workspace root.
  const appRoot = resolve(options.appPath);
  const candidates = [
    resolve(appRoot, "..", "ui", "dist"),
    resolve(appRoot, "app", "ui", "dist"),
    resolve(appRoot, "..", "..", "app", "ui", "dist"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

/**
 * Resolve an installed external resource while rejecting path traversal. The
 * helper is intentionally pure so packaged path behavior can be unit-tested
 * without starting Electron.
 */
export function getPackagedResourcePath(resourcesPath: string, relativePath: string): string | null {
  if (!relativePath || relativePath.includes("\0")) return null;
  const root = resolve(resourcesPath);
  const candidate = resolve(root, relativePath);
  const child = relative(root, candidate);
  if (child === ".." || child.startsWith(`..${sep}`) || child === "") return null;
  return candidate;
}
