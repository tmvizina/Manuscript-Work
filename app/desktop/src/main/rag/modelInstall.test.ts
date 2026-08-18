import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installRagModelWeights } from "./modelInstall.js";

const WEIGHTS = Buffer.from("pretend onnx weights");
const DIGEST = createHash("sha256").update(WEIGHTS).digest("hex");

let workspace: string;
let resources: string;
let userDataModelDir: string;
let source: string;

function writeManifest(overrides: Record<string, unknown> = {}) {
  const manifest = {
    schemaVersion: 1,
    modelId: "Xenova/all-MiniLM-L6-v2",
    upstreamModelId: "sentence-transformers/all-MiniLM-L6-v2",
    license: "Apache-2.0",
    publisher: "Xenova",
    embeddingDim: 384,
    quantization: "8-bit dynamic",
    files: [
      { fileName: "model_quantized.onnx", role: "model", sourceUrl: "https://huggingface.co/x", sha256: DIGEST, sizeBytes: WEIGHTS.length },
      { fileName: "tokenizer.json", role: "tokenizer", sourceUrl: "https://huggingface.co/x", sha256: DIGEST, sizeBytes: WEIGHTS.length },
      { fileName: "tokenizer_config.json", role: "tokenizer", sourceUrl: "https://huggingface.co/x", sha256: DIGEST, sizeBytes: WEIGHTS.length },
      { fileName: "config.json", role: "tokenizer", sourceUrl: "https://huggingface.co/x", sha256: DIGEST, sizeBytes: WEIGHTS.length },
    ],
    ...overrides,
  };
  writeFileSync(join(resources, "rag-model", "manifest.json"), JSON.stringify(manifest), "utf8");
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "rag-install-"));
  resources = join(workspace, "resources");
  userDataModelDir = join(workspace, "userData", "rag-model");
  mkdirSync(join(resources, "rag-model"), { recursive: true });
  writeManifest();
  source = join(workspace, "model_quantized.onnx");
  writeFileSync(source, WEIGHTS);
});

afterEach(() => rmSync(workspace, { recursive: true, force: true }));

const install = (pick: () => Promise<string | null>) =>
  installRagModelWeights({ resourcesPath: resources, userDataModelDir, pickFile: pick });

describe("importing model weights", () => {
  it("installs a file whose hash matches the bundled manifest", async () => {
    const result = await install(async () => source);

    expect(result.status).toBe("installed");
    expect(readFileSync(join(userDataModelDir, "model_quantized.onnx"))).toEqual(WEIGHTS);
  });

  it("refuses a file whose contents do not match", async () => {
    // The chosen file is untrusted input; only the manifest inside the app
    // decides whether it is the right model.
    const tampered = join(workspace, "tampered", "model_quantized.onnx");
    mkdirSync(join(workspace, "tampered"));
    writeFileSync(tampered, Buffer.concat([WEIGHTS, Buffer.from("!")]));

    const result = await install(async () => tampered);

    expect(result.status).toBe("rejected");
    expect(existsSync(join(userDataModelDir, "model_quantized.onnx"))).toBe(false);
  });

  it("refuses a file of the wrong size before hashing it", async () => {
    const short = join(workspace, "short", "model_quantized.onnx");
    mkdirSync(join(workspace, "short"));
    writeFileSync(short, Buffer.from("tiny"));

    const result = await install(async () => short);

    expect(result.status).toBe("rejected");
    expect(result.message).toMatch(/bytes/);
  });

  it("refuses a file with an unexpected name", async () => {
    const misnamed = join(workspace, "something-else.onnx");
    writeFileSync(misnamed, WEIGHTS);

    const result = await install(async () => misnamed);

    expect(result.status).toBe("rejected");
    expect(result.message).toMatch(/model_quantized\.onnx/);
  });

  it("treats a cancelled picker as neither success nor failure", async () => {
    const result = await install(async () => null);

    expect(result.status).toBe("cancelled");
    expect(existsSync(join(userDataModelDir, "model_quantized.onnx"))).toBe(false);
  });

  it("reports an already-installed model without asking for a file", async () => {
    await install(async () => source);
    const pick = vi.fn(async () => source);

    const result = await installRagModelWeights({ resourcesPath: resources, userDataModelDir, pickFile: pick });

    expect(result.status).toBe("already_installed");
    expect(pick).not.toHaveBeenCalled();
  });

  it("replaces a corrupt existing copy rather than trusting its presence", async () => {
    mkdirSync(userDataModelDir, { recursive: true });
    writeFileSync(join(userDataModelDir, "model_quantized.onnx"), Buffer.from("corrupt"));

    const result = await install(async () => source);

    expect(result.status).toBe("installed");
    expect(readFileSync(join(userDataModelDir, "model_quantized.onnx"))).toEqual(WEIGHTS);
  });

  it("leaves no partial file behind when the copy fails", async () => {
    const result = await install(async () => join(workspace, "does-not-exist.onnx"));

    expect(result.status).toBe("rejected");
    expect(existsSync(join(userDataModelDir, "model_quantized.onnx.partial"))).toBe(false);
  });
});
