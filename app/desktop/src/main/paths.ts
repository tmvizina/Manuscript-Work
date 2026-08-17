import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { existsSync } from "node:fs";

export interface DesktopUserDataPaths {
  userData: string;
  logs: string;
  data: string;
  backups: string;
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
    backups: join(root, "backups"),
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

  // A relative() comparison alone does not contain a rooted path. On win32 a UNC
  // request such as `\\host\share\payload` (reachable as %5C%5C... through the UI
  // protocol) resolves to itself, and relative() then returns another rooted path
  // rather than a `..` prefix. Reject anything rooted before resolving, matching
  // resolveInside() in @book-writer/core. Backslashes are refused outright: served
  // UI assets are URL paths, so a separator only arrives here as an escape attempt.
  if (relativePath.includes("\\") || relativePath.startsWith("/") || isAbsolute(relativePath)) return null;
  if (/^[a-zA-Z]:/.test(relativePath)) return null;

  const root = resolve(resourcesPath);
  const candidate = resolve(root, relativePath);
  const child = relative(root, candidate);
  if (child === ".." || child.startsWith(`..${sep}`) || child === "" || isAbsolute(child)) return null;
  return candidate;
}
