/**
 * WordPiece tokenization for the bundled MiniLM model.
 *
 * The model ships its own `tokenizer.json`, and every field this file honours
 * is read from that file rather than hard-coded: BertNormalizer
 * (clean_text/handle_chinese_chars/strip_accents/lowercase), BertPreTokenizer,
 * the WordPiece vocabulary, and the `[CLS] … [SEP]` template.
 *
 * This is a hand port rather than a dependency. The alternative,
 * `@huggingface/transformers`, weighs ~13 MB and exists here only to tokenize;
 * its inference half is already covered by onnxruntime-node. Correctness is
 * not assumed: wordPiece.test.ts pins the output against ids produced by the
 * real Python `tokenizers` library reading this exact tokenizer.json, because
 * a subtly wrong tokenizer degrades retrieval quality without failing loudly.
 */

export interface WordPieceConfig {
  vocab: Map<string, number>;
  unkToken: string;
  clsToken: string;
  sepToken: string;
  continuingSubwordPrefix: string;
  maxInputCharsPerWord: number;
  lowercase: boolean;
  stripAccents: boolean;
  handleChineseChars: boolean;
  cleanText: boolean;
}

export interface TokenizedText {
  ids: number[];
}

/** CJK blocks that BertNormalizer isolates with surrounding spaces. */
const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f],
  [0x2b820, 0x2ceaf],
  [0xf900, 0xfaff],
  [0x2f800, 0x2fa1f],
];

function isChineseChar(codePoint: number): boolean {
  return CJK_RANGES.some(([start, end]) => codePoint >= start && codePoint <= end);
}

/** Matches Python's `unicodedata.category(ch).startswith("C")`, minus the
 * whitespace characters BERT handles separately. */
function isControl(char: string): boolean {
  if (char === "\t" || char === "\n" || char === "\r") return false;
  return /\p{C}/u.test(char);
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || /\p{Zs}/u.test(char);
}

/** BERT treats the ASCII symbol ranges as punctuation even though Unicode
 * classifies some of them as symbols (e.g. `$`, `+`, `^`). */
function isPunctuation(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  if ((cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) || (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126)) {
    return true;
  }
  return /\p{P}/u.test(char);
}

function stripAccentsFrom(text: string): string {
  return text.normalize("NFD").replace(/\p{Mn}/gu, "");
}

/** Parse the subset of tokenizer.json this tokenizer implements. */
export function parseWordPieceConfig(tokenizerJson: unknown): WordPieceConfig {
  const root = tokenizerJson as Record<string, any>;
  const model = root?.model;
  if (!model || model.type !== "WordPiece" || !model.vocab) {
    throw new Error("tokenizer.json does not describe a WordPiece model");
  }
  const normalizer = root.normalizer ?? {};
  if (normalizer.type && normalizer.type !== "BertNormalizer") {
    throw new Error(`Unsupported tokenizer normalizer: ${String(normalizer.type)}`);
  }
  if (root.pre_tokenizer?.type && root.pre_tokenizer.type !== "BertPreTokenizer") {
    throw new Error(`Unsupported tokenizer pre_tokenizer: ${String(root.pre_tokenizer.type)}`);
  }

  const vocab = new Map<string, number>();
  for (const [token, id] of Object.entries(model.vocab as Record<string, number>)) {
    vocab.set(token, id);
  }

  const lowercase = normalizer.lowercase !== false;
  return {
    vocab,
    unkToken: typeof model.unk_token === "string" ? model.unk_token : "[UNK]",
    clsToken: "[CLS]",
    sepToken: "[SEP]",
    continuingSubwordPrefix: typeof model.continuing_subword_prefix === "string" ? model.continuing_subword_prefix : "##",
    maxInputCharsPerWord: typeof model.max_input_chars_per_word === "number" ? model.max_input_chars_per_word : 100,
    lowercase,
    // `strip_accents: null` means "follow lowercase", which is how the
    // reference implementation resolves it.
    stripAccents: normalizer.strip_accents === null || normalizer.strip_accents === undefined ? lowercase : Boolean(normalizer.strip_accents),
    handleChineseChars: normalizer.handle_chinese_chars !== false,
    cleanText: normalizer.clean_text !== false,
  };
}

function normalize(text: string, config: WordPieceConfig): string {
  let output = "";
  for (const char of text) {
    if (config.cleanText) {
      const cp = char.codePointAt(0) ?? 0;
      if (cp === 0 || cp === 0xfffd || isControl(char)) continue;
      if (isWhitespace(char)) {
        output += " ";
        continue;
      }
    }
    if (config.handleChineseChars && isChineseChar(char.codePointAt(0) ?? 0)) {
      output += ` ${char} `;
      continue;
    }
    output += char;
  }

  if (config.lowercase) output = output.toLowerCase();
  if (config.stripAccents) output = stripAccentsFrom(output);
  return output;
}

/** Whitespace split, then punctuation split, matching BertPreTokenizer. */
function preTokenize(text: string): string[] {
  const words: string[] = [];
  for (const chunk of text.split(/\s+/u)) {
    if (chunk.length === 0) continue;
    let current = "";
    for (const char of chunk) {
      if (isPunctuation(char)) {
        if (current.length > 0) {
          words.push(current);
          current = "";
        }
        words.push(char);
        continue;
      }
      current += char;
    }
    if (current.length > 0) words.push(current);
  }
  return words;
}

/** Greedy longest-match-first subword lookup. */
function wordPieceEncode(word: string, config: WordPieceConfig): string[] {
  const characters = [...word];
  if (characters.length > config.maxInputCharsPerWord) return [config.unkToken];

  const tokens: string[] = [];
  let start = 0;
  while (start < characters.length) {
    let end = characters.length;
    let match: string | null = null;
    while (start < end) {
      const candidate = (start > 0 ? config.continuingSubwordPrefix : "") + characters.slice(start, end).join("");
      if (config.vocab.has(candidate)) {
        match = candidate;
        break;
      }
      end -= 1;
    }
    if (match === null) return [config.unkToken];
    tokens.push(match);
    start = end;
  }
  return tokens;
}

/**
 * Encode one string to model input ids, wrapped in `[CLS] … [SEP]`.
 *
 * `maxTokens` bounds the total sequence including both special tokens; MiniLM
 * is trained at 256 and produces meaningless output beyond its positional
 * range, so the text is truncated rather than allowed to overflow.
 */
export function encodeText(text: string, config: WordPieceConfig, maxTokens: number): TokenizedText {
  const cls = config.vocab.get(config.clsToken);
  const sep = config.vocab.get(config.sepToken);
  const unk = config.vocab.get(config.unkToken);
  if (cls === undefined || sep === undefined || unk === undefined) {
    throw new Error("tokenizer vocabulary is missing a required special token");
  }

  const ids: number[] = [cls];
  const budget = Math.max(2, maxTokens) - 2;

  outer: for (const word of preTokenize(normalize(text, config))) {
    for (const token of wordPieceEncode(word, config)) {
      if (ids.length - 1 >= budget) break outer;
      ids.push(config.vocab.get(token) ?? unk);
    }
  }
  ids.push(sep);
  return { ids };
}
