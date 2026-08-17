import { describe, expect, it } from "vitest";
import { groupWorld } from "./WorldPage";

describe("WorldPage grouping", () => {
  it("groups flat native summaries by normalized relative directory", () => {
    const groups = groupWorld([
      { documentId: "root", relPath: "overview.md", title: "Overview" },
      { documentId: "aria", relPath: "characters\\Aria.md", title: "Aria" },
      { documentId: "borin", relPath: "characters/Borin.md", title: "Borin" },
    ]);

    expect(groups.map((group) => [group.dir, group.files.map((file) => file.documentId)])).toEqual([
      ["", ["root"]],
      ["characters", ["aria", "borin"]],
    ]);
  });
});
