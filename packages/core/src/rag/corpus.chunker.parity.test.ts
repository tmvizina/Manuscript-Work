import { describe, expect, it } from "vitest";
import { chunkText } from "./corpus.js";

/**
 * Parity fixtures for `chunkText` against `rag/raglib.py::chunk_file`
 * (`_paragraphs`/`_split_long`/the chunk-grouping loop). Every `text`/
 * `expected` value below was captured by running the actual Python
 * functions against the same input and copying their output verbatim — this
 * test fails the moment the TypeScript port's behavior drifts from what
 * raglib.py actually produces, not just from what the port is believed to
 * produce. See the "heading run on" case especially: it exercises the subtle
 * interaction where a heading paragraph that is itself oversize gets split
 * by the sentence-boundary fallback, and its first (heading-bearing) piece
 * can then reappear via the one-paragraph overlap in the following chunk.
 */

interface ParityCase {
  name: string;
  isMarkdown: boolean;
  text: string;
  expected: Array<{ heading: string; text: string }>;
}

const CASES: ParityCase[] = [
  {
    name: "simple multi paragraph",
    isMarkdown: false,
    text: "Para one sentence one. Sentence two.\n\nPara two sentence one. Sentence two.\n\nPara three.",
    expected: [
      { heading: "", text: "Para one sentence one. Sentence two.\n\nPara two sentence one. Sentence two.\n\nPara three." },
    ],
  },
  {
    name: "paragraph overlap split",
    isMarkdown: false,
    text: `${"A".repeat(500)}\n\n${"B".repeat(500)}\n\n${"C".repeat(500)}\n\n${"D".repeat(500)}`,
    expected: [
      { heading: "", text: `${"A".repeat(500)}\n\n${"B".repeat(500)}` },
      { heading: "", text: `${"B".repeat(500)}\n\n${"C".repeat(500)}` },
      { heading: "", text: `${"C".repeat(500)}\n\n${"D".repeat(500)}` },
    ],
  },
  {
    name: "markdown headings",
    isMarkdown: true,
    text: "# Title Heading\n\nIntro paragraph under title.\n\n## Section One\n\nContent for section one, fairly short.\n\n## Section Two\n\nContent for section two, also short.\n",
    expected: [
      { heading: "Title Heading", text: "# Title Heading\n\nIntro paragraph under title." },
      { heading: "Section One", text: "## Section One\n\nContent for section one, fairly short." },
      { heading: "Section Two", text: "## Section Two\n\nContent for section two, also short." },
    ],
  },
  {
    name: "oversize paragraph sentence split",
    isMarkdown: false,
    text:
      "Intro paragraph, short.\n\n" +
      Array(20)
        .fill("This is a moderately long sentence about dragons and orchards that repeats itself for length.")
        .join(" ") +
      "\n\nOutro paragraph, short.",
    expected: [
      {
        heading: "",
        text:
          "Intro paragraph, short.\n\n" +
          Array(12)
            .fill("This is a moderately long sentence about dragons and orchards that repeats itself for length.")
            .join(" "),
      },
      {
        heading: "",
        text:
          Array(12).fill("This is a moderately long sentence about dragons and orchards that repeats itself for length.").join(" ") +
          "\n\n" +
          Array(8).fill("This is a moderately long sentence about dragons and orchards that repeats itself for length.").join(" "),
      },
      {
        heading: "",
        text:
          Array(8).fill("This is a moderately long sentence about dragons and orchards that repeats itself for length.").join(" ") +
          "\n\nOutro paragraph, short.",
      },
    ],
  },
  {
    name: "markdown heading run on",
    isMarkdown: true,
    text: `# Heading Alpha\n${Array(60).fill("Lorem ipsum dolor sit amet.").join(" ")}`,
    expected: [
      {
        heading: "Heading Alpha",
        text: `# Heading Alpha\n${Array(42).fill("Lorem ipsum dolor sit amet.").join(" ")}`,
      },
      {
        heading: "Heading Alpha",
        text:
          `# Heading Alpha\n${Array(42).fill("Lorem ipsum dolor sit amet.").join(" ")}` +
          "\n\n" +
          Array(18).fill("Lorem ipsum dolor sit amet.").join(" "),
      },
    ],
  },
  {
    name: "json file no heading",
    isMarkdown: true,
    text: '{\n  "name": "Mira",\n  "notes": "Some notes about Mira that are somewhat long but not oversize."\n}',
    expected: [
      { heading: "", text: '{\n  "name": "Mira",\n  "notes": "Some notes about Mira that are somewhat long but not oversize."\n}' },
    ],
  },
  {
    name: "irregular blank lines",
    isMarkdown: false,
    text: "First paragraph.\n\n\n\nSecond paragraph after multiple blank lines.\n   \nThird paragraph after a whitespace-only line.\n\n",
    expected: [
      {
        heading: "",
        text: "First paragraph.\n\nSecond paragraph after multiple blank lines.\n\nThird paragraph after a whitespace-only line.",
      },
    ],
  },
  {
    name: "boundary exact 1200",
    isMarkdown: false,
    text: `${"X".repeat(700)}\n\n${"Y".repeat(500)}\n\n${"Z".repeat(10)}`,
    expected: [
      { heading: "", text: `${"X".repeat(700)}\n\n${"Y".repeat(500)}` },
      { heading: "", text: `${"Y".repeat(500)}\n\n${"Z".repeat(10)}` },
    ],
  },
];

describe("chunkText parity with rag/raglib.py::chunk_file", () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const chunks = chunkText(testCase.text, testCase.isMarkdown);
      expect(chunks.map((chunk) => ({ heading: chunk.heading, text: chunk.text }))).toEqual(testCase.expected);
      // charCount is our own bookkeeping (raglib.py has no equivalent field)
      // but must always describe the emitted text exactly.
      for (const chunk of chunks) expect(chunk.charCount).toBe(chunk.text.length);
    });
  }

  it("assigns sequential chunkIndex starting at 0", () => {
    const chunks = chunkText(CASES[1].text, CASES[1].isMarkdown);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
  });
});
