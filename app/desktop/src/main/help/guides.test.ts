import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HELP_SECTIONS, findHelpSection, listHelpSections, readHelpGuide, resolveGuidesRoot } from "./guides.js";

let workspace: string;
let guides: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "help-guides-"));
  guides = join(workspace, "guides");
  mkdirSync(guides, { recursive: true });
});

afterEach(() => rmSync(workspace, { recursive: true, force: true }));

describe("bundled guide library", () => {
  it("covers the nonfiction workflow alongside the fiction guides", () => {
    // The desktop Help stub previously summarised this in one card; losing it
    // in the migration would leave nonfiction projects undocumented.
    const nonfiction = findHelpSection("nonfiction");

    expect(nonfiction).toBeDefined();
    expect(nonfiction?.fileName).toBe("nonfiction-knowledge-base.md");
    expect(HELP_SECTIONS.map((section) => section.slug)).toContain("commands");
  });

  it("reads a guide that is present", () => {
    writeFileSync(join(guides, "commands-reference.md"), "# Commands\n\nBody.", "utf8");

    expect(readHelpGuide(guides, "commands")).toEqual({
      slug: "commands",
      title: "Command Reference",
      format: "markdown",
      text: "# Commands\n\nBody.",
    });
  });

  it("returns null for an unknown slug rather than touching the filesystem", () => {
    expect(readHelpGuide(guides, "../../../etc/passwd")).toBeNull();
    expect(readHelpGuide(guides, "does-not-exist")).toBeNull();
  });

  it("returns null for a guide missing from this build", () => {
    expect(readHelpGuide(guides, "commands")).toBeNull();
  });

  it("refuses a symlinked guide rather than following it out of the bundle", () => {
    const outside = join(workspace, "outside.md");
    writeFileSync(outside, "secret", "utf8");
    try {
      symlinkSync(outside, join(guides, "commands-reference.md"));
    } catch {
      return; // Creating symlinks needs privileges this account may not have.
    }

    expect(readHelpGuide(guides, "commands")).toBeNull();
  });

  it("marks sections whose files are absent as unavailable", () => {
    writeFileSync(join(guides, "rag-overview.md"), "# RAG", "utf8");

    const listed = listHelpSections(guides);

    expect(listed.find((section) => section.slug === "rag")?.available).toBe(true);
    expect(listed.find((section) => section.slug === "commands")?.available).toBe(false);
    expect(listed).toHaveLength(HELP_SECTIONS.length);
  });

  it("resolves the guides directory beneath packaged resources", () => {
    expect(resolveGuidesRoot("C:/installed/resources")).toBe(resolve("C:/installed/resources/guides"));
  });
});
