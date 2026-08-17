import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeText, parseWordPieceConfig, type WordPieceConfig } from "./wordPiece.js";

/**
 * Reference ids produced by the real Python `tokenizers` library (0.22.2)
 * reading this repository's own
 * app/desktop/resources/rag-model/tokenizer.json, with padding and truncation
 * disabled so the fixture is the raw token sequence.
 *
 * Regenerate with:
 *   from tokenizers import Tokenizer
 *   tok = Tokenizer.from_file("app/desktop/resources/rag-model/tokenizer.json")
 *   tok.no_padding(); tok.no_truncation()
 *   tok.encode(text).ids
 *
 * These cover the behaviours a hand-written WordPiece port gets wrong:
 * accent stripping, punctuation splitting, subword continuation, the
 * max-chars-per-word fallback to [UNK], control/whitespace cleanup, and
 * non-BMP characters.
 */
const REFERENCE: ReadonlyArray<{ text: string; ids: number[] }> = [
  { text: "The dragon's wings blotted out the sun.", ids: [101, 1996, 5202, 1005, 1055, 4777, 1038, 10994, 3064, 2041, 1996, 3103, 1012, 102] },
  { text: "Mira knelt beside the broken seal.", ids: [101, 18062, 12804, 3875, 1996, 3714, 7744, 1012, 102] },
  { text: "hello world", ids: [101, 7592, 2088, 102] },
  { text: "HELLO WORLD", ids: [101, 7592, 2088, 102] },
  { text: "Café naïve résumé", ids: [101, 7668, 15743, 13746, 102] },
  { text: "punctuation, semicolons; and-hyphens!", ids: [101, 26136, 6593, 14505, 1010, 4100, 25778, 5644, 1025, 1998, 1011, 1044, 22571, 10222, 2015, 999, 102] },
  { text: "unbelievablesupercalifragilistic", ids: [101, 23653, 6342, 4842, 9289, 10128, 29181, 24411, 4588, 102] },
  { text: "xyzzyqwertyuiopasdfgh", ids: [101, 1060, 2100, 28753, 4160, 13777, 3723, 10179, 29477, 16150, 2546, 5603, 102] },
  { text: "a".repeat(120), ids: [101, 100, 102] },
  { text: "", ids: [101, 102] },
  { text: "   ", ids: [101, 102] },
  { text: "line one\n\nline two\ttabbed", ids: [101, 2240, 2028, 2240, 2048, 21628, 8270, 102] },
  { text: "Numbers 1234 and 56.78 mixed", ids: [101, 3616, 13138, 2549, 1998, 5179, 1012, 6275, 3816, 102] },
  { text: "emoji 🐉 dragon", ids: [101, 7861, 29147, 2072, 100, 5202, 102] },
];

const tokenizerPath = resolve(__dirname, "..", "..", "..", "resources", "rag-model", "tokenizer.json");

function loadConfig(): WordPieceConfig | null {
  try {
    return parseWordPieceConfig(JSON.parse(readFileSync(tokenizerPath, "utf8")));
  } catch {
    // The weights are fetched at build time and are absent on a fresh clone.
    return null;
  }
}

const config = loadConfig();

describe.skipIf(config === null)("WordPiece parity with the reference tokenizer", () => {
  for (const { text, ids } of REFERENCE) {
    const label = text.length > 32 ? `${text.slice(0, 32)}…` : JSON.stringify(text);
    it(`matches reference ids for ${label}`, () => {
      expect(encodeText(text, config as WordPieceConfig, 256).ids).toEqual(ids);
    });
  }

  it("truncates to the model's positional limit while keeping both special tokens", () => {
    // MiniLM is trained at 256 positions; longer input must be cut rather than
    // silently fed to the model.
    const long = "dragon ".repeat(400);
    const encoded = encodeText(long, config as WordPieceConfig, 256);

    expect(encoded.ids).toHaveLength(256);
    expect(encoded.ids[0]).toBe(101);
    expect(encoded.ids.at(-1)).toBe(102);
  });

  it("reads its settings from tokenizer.json rather than assuming them", () => {
    const loaded = config as WordPieceConfig;

    expect(loaded.lowercase).toBe(true);
    expect(loaded.stripAccents).toBe(true);
    expect(loaded.continuingSubwordPrefix).toBe("##");
    expect(loaded.maxInputCharsPerWord).toBe(100);
    expect(loaded.vocab.size).toBe(30522);
  });
});

describe("WordPiece configuration parsing", () => {
  it("rejects a tokenizer this port does not implement", () => {
    expect(() => parseWordPieceConfig({ model: { type: "BPE", vocab: {} } })).toThrow(/WordPiece/);
    expect(() =>
      parseWordPieceConfig({ model: { type: "WordPiece", vocab: {} }, normalizer: { type: "Precompiled" } }),
    ).toThrow(/normalizer/);
    expect(() =>
      parseWordPieceConfig({ model: { type: "WordPiece", vocab: {} }, pre_tokenizer: { type: "Metaspace" } }),
    ).toThrow(/pre_tokenizer/);
  });

  it("resolves a null strip_accents to the lowercase setting", () => {
    // tokenizer.json leaves strip_accents null, which the reference
    // implementation resolves to lowercase rather than to false.
    const base = { model: { type: "WordPiece", vocab: { "[UNK]": 0 } } };

    expect(parseWordPieceConfig({ ...base, normalizer: { lowercase: true, strip_accents: null } }).stripAccents).toBe(true);
    expect(parseWordPieceConfig({ ...base, normalizer: { lowercase: false, strip_accents: null } }).stripAccents).toBe(false);
    expect(parseWordPieceConfig({ ...base, normalizer: { lowercase: true, strip_accents: false } }).stripAccents).toBe(false);
  });
});
