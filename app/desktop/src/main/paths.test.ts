import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getPackagedResourcePath, getUiRoot, getUserDataPaths } from "./paths.js";

describe("desktop path policy", () => {
  it("keeps mutable application data below Electron userData", () => {
    const root = resolve("C:/book-writer-user-data");

    expect(getUserDataPaths(root)).toEqual({
      userData: root,
      logs: join(root, "logs"),
      data: join(root, "data"),
      backups: join(root, "backups"),
      projects: join(root, "projects"),
    });
  });

  it("always resolves packaged UI from resources", () => {
    expect(
      getUiRoot({
        isPackaged: true,
        appPath: "C:/installed/app.asar",
        resourcesPath: "C:/installed/resources",
        developmentUiRoot: "C:/untrusted-override",
      }),
    ).toBe(resolve("C:/installed/resources/ui"));
  });

  it("accepts only non-root descendants of a packaged resource root", () => {
    const root = resolve("C:/installed/resources/ui");

    expect(getPackagedResourcePath(root, "assets/index.js")).toBe(resolve(root, "assets/index.js"));
    expect(getPackagedResourcePath(root, "../secret.txt")).toBeNull();
    expect(getPackagedResourcePath(root, ".")).toBeNull();
    expect(getPackagedResourcePath(root, "")).toBeNull();
    expect(getPackagedResourcePath(root, "assets/evil\0.js")).toBeNull();
  });

  it("refuses rooted requests that resolve outside the resource root", () => {
    const root = resolve("C:/installed/resources/ui");

    // Reachable through the UI protocol: `book-writer://app/%5C%5Chost%5Cshare`
    // decodes to a UNC path, which resolve() honors instead of containing.
    expect(getPackagedResourcePath(root, "\\\\attacker-host\\share\\payload")).toBeNull();
    expect(getPackagedResourcePath(root, "\\\\127.0.0.1\\C$\\Windows\\win.ini")).toBeNull();
    expect(getPackagedResourcePath(root, "C:\\Windows\\System32\\calc.exe")).toBeNull();
    expect(getPackagedResourcePath(root, "C:/Windows/System32/calc.exe")).toBeNull();
    expect(getPackagedResourcePath(root, "/etc/passwd")).toBeNull();
    expect(getPackagedResourcePath(root, "assets\\..\\..\\secret.txt")).toBeNull();
  });
});
