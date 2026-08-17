import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RAG_MODEL_DIRECTORY_NAME,
  RagModelManifestError,
  parseRagModelManifest,
  resolveVerifiedRagModel,
  verifyRagModelDirectory,
  type RagModelVerifierOptions,
} from "./modelManifest.js";

const MODEL_DIR = "C:/installed/resources/rag-model";

const FILE_BYTES: Record<string, Buffer> = {
  "model_quantized.onnx": Buffer.from("onnx-model-bytes"),
  "tokenizer.json": Buffer.from("tokenizer-bytes"),
  "tokenizer_config.json": Buffer.from("tokenizer-config-bytes"),
  "config.json": Buffer.from("config-bytes"),
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function manifestObject() {
  return {
    schemaVersion: 1,
    modelId: "Xenova/all-MiniLM-L6-v2",
    upstreamModelId: "sentence-transformers/all-MiniLM-L6-v2",
    license: "Apache-2.0",
    publisher: "Xenova",
    embeddingDim: 384,
    quantization: "8-bit dynamic",
    files: [
      { fileName: "model_quantized.onnx", role: "model" },
      { fileName: "tokenizer.json", role: "tokenizer" },
      { fileName: "tokenizer_config.json", role: "tokenizer" },
      { fileName: "config.json", role: "tokenizer" },
    ].map((entry) => ({
      ...entry,
      sourceUrl: `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/${entry.fileName}`,
      sha256: sha256(FILE_BYTES[entry.fileName]),
      sizeBytes: FILE_BYTES[entry.fileName].length,
    })),
  };
}

/**
 * A verifier wired to an in-memory directory. `mutate` lets each test break
 * exactly one thing, so a failure names the specific defect it represents.
 */
function verifier(mutate: (state: { manifest: ReturnType<typeof manifestObject>; files: Record<string, Buffer>; present: Set<string> }) => void = () => {}) {
  const state = {
    manifest: manifestObject(),
    files: { ...FILE_BYTES },
    present: new Set(["LICENSE", "NOTICE"]),
  };
  mutate(state);

  const resolveName = (path: string) => path.slice(path.replace(/\\/g, "/").lastIndexOf("/") + 1);

  const options: RagModelVerifierOptions = {
    readFile: (path) => {
      const name = resolveName(path);
      if (name === "manifest.json") {
        if (state.manifest === null) {
          throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        }
        return Buffer.from(JSON.stringify(state.manifest));
      }
      const bytes = state.files[name];
      if (!bytes) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return bytes;
    },
    statSize: (path) => {
      const name = resolveName(path);
      // LICENSE/NOTICE are checked for presence and non-emptiness rather than
      // hashed, so they carry a nominal size instead of fixture bytes.
      if (name === "LICENSE" || name === "NOTICE") {
        if (!state.present.has(name)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        return 1024;
      }
      const bytes = state.files[name];
      if (!bytes) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return bytes.length;
    },
    sha256,
    exists: (path) => state.present.has(resolveName(path)),
  };
  return () => verifyRagModelDirectory(MODEL_DIR, options);
}

function expectCode(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RagModelManifestError);
    expect((error as RagModelManifestError).code).toBe(code);
    return;
  }
  throw new Error(`expected a RagModelManifestError with code "${code}", but nothing was thrown`);
}

describe("RAG model manifest verification", () => {
  it("accepts a manifest whose files match byte for byte", () => {
    const verified = verifier()();

    expect(verified).toEqual({
      modelPath: join(MODEL_DIR, "model_quantized.onnx"),
      tokenizerDir: MODEL_DIR,
      modelId: "Xenova/all-MiniLM-L6-v2",
      modelSha256: sha256(FILE_BYTES["model_quantized.onnx"]),
      embeddingDim: 384,
    });
  });

  it("refuses a tampered file rather than loading it", () => {
    // The whole point of shipping a hash: bytes swapped after packaging must
    // not be fed to the embedder.
    expectCode(
      verifier((state) => {
        state.files["model_quantized.onnx"] = Buffer.from("onnx-model-byteS");
      }),
      "file_hash_mismatch",
    );
  });

  it("refuses a file whose size disagrees with the manifest", () => {
    expectCode(
      verifier((state) => {
        state.files["tokenizer.json"] = Buffer.from("short");
      }),
      "file_size_mismatch",
    );
  });

  it("refuses a missing model file", () => {
    expectCode(
      verifier((state) => {
        delete state.files["config.json"];
      }),
      "file_missing",
    );
  });

  it("refuses a missing manifest instead of loading unverified bytes", () => {
    expectCode(
      verifier((state) => {
        (state as { manifest: unknown }).manifest = null;
      }),
      "manifest_missing",
    );
  });

  it("requires the Apache-2.0 license and notice to ship with the weights", () => {
    // Redistributing the model without them would breach its license.
    expectCode(
      verifier((state) => {
        state.present.delete("LICENSE");
      }),
      "license_missing",
    );
    expectCode(
      verifier((state) => {
        state.present.delete("NOTICE");
      }),
      "notice_missing",
    );
  });

  it("rejects a manifest listing a file set other than the expected one", () => {
    expectCode(
      verifier((state) => {
        state.manifest.files.push({
          fileName: "extra.bin",
          role: "tokenizer",
          sourceUrl: "https://example.invalid/extra.bin",
          sha256: sha256(Buffer.from("x")),
          sizeBytes: 1,
        });
      }),
      "manifest_file_set_invalid",
    );
  });

  it("rejects unknown and malformed manifest fields", () => {
    expectCode(() => parseRagModelManifest({ ...manifestObject(), surprise: true }), "manifest_unknown_key");
    expectCode(() => parseRagModelManifest({ ...manifestObject(), embeddingDim: 0 }), "manifest_field_invalid");
    expectCode(() => parseRagModelManifest("not json at all"), "manifest_parse_failed");
    expectCode(() => parseRagModelManifest(JSON.stringify([1, 2, 3])), "manifest_not_object");
  });

  it("resolves the model directory beneath the packaged resources path", () => {
    expectCode(() => resolveVerifiedRagModel("C:/installed/resources"), "manifest_missing");
  });
});

describe("the checked-in manifest", () => {
  // Guards the real file the build depends on: if it drifts out of the shape
  // the verifier accepts, packaging would fail late instead of here.
  const manifestPath = resolve(__dirname, "..", "..", "..", "resources", RAG_MODEL_DIRECTORY_NAME, "manifest.json");

  it("parses and describes the expected model", () => {
    const manifest = parseRagModelManifest(readFileSync(manifestPath, "utf8"));

    expect(manifest.modelId).toBe("Xenova/all-MiniLM-L6-v2");
    expect(manifest.license).toBe("Apache-2.0");
    expect(manifest.embeddingDim).toBe(384);
    expect(manifest.files.map((entry) => entry.fileName).sort()).toEqual([
      "config.json",
      "model_quantized.onnx",
      "tokenizer.json",
      "tokenizer_config.json",
    ]);
    for (const entry of manifest.files) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.sourceUrl.startsWith("https://huggingface.co/")).toBe(true);
    }
  });
});
