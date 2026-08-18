import { describe, expect, it } from "vitest";
import { buildWorldNameMap, linkifyReviewIds, linkifyWikiRefs, renderMarkdown, renderReviewMarkdown, renderWorldMarkdown } from "./markdown";
import type { WorldSummary } from "../transport";

const world: WorldSummary[] = [
  { documentId: "world:world/characters/mira.md", relPath: "world/characters/mira.md", title: "mira" },
  { documentId: "world:world/places/the deep.md", relPath: "world/places/the deep.md", title: "the deep" },
];

describe("world cross-references", () => {
  it("links a wiki reference to the world file that defines it", () => {
    expect(linkifyWikiRefs("Mentioned [[Mira]] here.", buildWorldNameMap(world)))
      .toBe("Mentioned [Mira](#/world/world/characters/mira.md) here.");
  });

  it("matches names case-insensitively, as the server does", () => {
    expect(linkifyWikiRefs("[[MIRA]]", buildWorldNameMap(world))).toContain("#/world/world/characters/mira.md");
  });

  it("marks an unwritten reference instead of leaving a dead link", () => {
    // Visible missing canon is the point; a plain-text token would hide it.
    expect(linkifyWikiRefs("[[Nobody]]", buildWorldNameMap(world)))
      .toBe('<span class="wiki-missing" title="No world file with this name yet">Nobody</span>');
  });

  it("percent-encodes a target containing spaces", () => {
    expect(linkifyWikiRefs("[[The Deep]]", buildWorldNameMap(world))).toContain("#/world/world/places/the%20deep.md");
  });

  it("falls back to the file name when a summary has no title", () => {
    const untitled: WorldSummary[] = [{ documentId: "d", relPath: "world/factions/wardens.md" }];

    expect(buildWorldNameMap(untitled).get("wardens")).toBe("world/factions/wardens.md");
  });

  it("renders a world document to HTML with its references resolved", () => {
    const html = renderWorldMarkdown("# Notes\n\nSee [[Mira]].", world);

    expect(html).toContain("<h1>Notes</h1>");
    expect(html).toContain('href="#/world/world/characters/mira.md"');
  });
});

describe("review pipeline ids", () => {
  const index = new Map([["RV-001", "reviews/2026-01-01-review.md"], ["EP-002", "editing-plan/plan.md"]]);

  it("links an id to the document that defines it", () => {
    expect(linkifyReviewIds("<p>RV-001</p>", index, "editing-plan/plan.md"))
      .toBe('<p><a class="ref-id" href="#/reviews/reviews/2026-01-01-review.md">RV-001</a></p>');
  });

  it("marks but does not self-link an id defined by the document being read", () => {
    expect(linkifyReviewIds("<p>EP-002</p>", index, "editing-plan/plan.md"))
      .toBe('<p><span class="ref-id">EP-002</span></p>');
  });

  it("marks an id that no document defines", () => {
    expect(linkifyReviewIds("<p>WP-999</p>", index, "x.md")).toContain('<span class="ref-id">WP-999</span>');
  });

  it("renders a review and links the chain", () => {
    const html = renderReviewMarkdown("## Findings\n\nSee RV-001.", [{ id: "RV-001", relPath: "reviews/r.md" }], "editing-plan/plan.md");

    expect(html).toContain("<h2>Findings</h2>");
    expect(html).toContain('href="#/reviews/reviews/r.md"');
  });
});

describe("renderMarkdown", () => {
  it("renders headings, lists, and emphasis", () => {
    const html = renderMarkdown("# Title\n\n- one\n- two\n\n**bold**");

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<strong>bold</strong>");
  });
});
