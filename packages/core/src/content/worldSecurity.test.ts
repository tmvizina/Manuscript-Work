import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listWorld, readWorldFile } from "./world.js";

const roots: string[] = [];

function projectRoot(name: string): string {
  const base = join(process.cwd(), ".tmp-tests");
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, name));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("world content physical containment", () => {
  it("does not follow symlinked world files or directories", () => {
    const root = projectRoot("world-root-");
    const outside = projectRoot("world-outside-");
    mkdirSync(join(root, "world"), { recursive: true });
    writeFileSync(join(root, "world", "inside.md"), "inside", "utf8");
    writeFileSync(join(outside, "secret.md"), "secret", "utf8");

    try {
      symlinkSync(join(outside, "secret.md"), join(root, "world", "linked.md"), "file");
      symlinkSync(outside, join(root, "world", "linked-directory"), "junction");
    } catch {
      // Windows can deny symlink creation when Developer Mode is disabled.
    }

    const listed = listWorld(root).groups.flatMap((group) => group.files.map((file) => file.rel_path));
    expect(listed).toEqual(["inside.md"]);
    expect(readWorldFile(root, "inside.md")?.text).toBe("inside");
    expect(readWorldFile(root, "linked.md")).toBeNull();
    expect(readWorldFile(root, "linked-directory/secret.md")).toBeNull();
  });
});
