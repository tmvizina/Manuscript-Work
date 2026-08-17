#!/usr/bin/env node
// Ticket 1 (native RAG design): prove — or disprove — that onnxruntime-node's
// N-API (napi-v6) prebuilt loads and runs inside the PACKAGED, unpacked
// Electron build, against the real pinned Electron ABI, with no
// electron-rebuild-equivalent step performed anywhere in this script or the
// package scripts that produced the build under test.
//
// Method: spawn the packaged app's own renamed Electron executable with
// ELECTRON_RUN_AS_NODE=1 (Electron's documented headless "run as node" mode —
// no app bootstrap, no window, nothing rendered) and, inside that process,
// require onnxruntime-node through the real app.asar the same way the
// packaged app's own code would, then run one real inference through the
// native CPU execution provider. This is the same asarUnpack transparency
// this app already relies on for better-sqlite3's native binary.
//
// Also resolves design §3's open question: whether DirectML.dll /
// dxcompiler.dll / dxil.dll (the DirectML GPU execution-provider's
// dependencies) can be excluded from packaging when only the CPU execution
// provider is ever used. electron-builder.yml already excludes them; this
// script asserts they are in fact absent from the packaged output and that
// CPU inference still works without them — turning the empirical finding
// into a standing regression guard.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const unpacked = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(root, "dist", "desktop", "win-unpacked");

// A minimal, genuine ONNX graph (C = A + B, float32[3] inputs), generated
// once with Python's onnx package and embedded here so this smoke test has
// no external fixture file and no network/model dependency of its own. It
// exercises the real ONNX Runtime native execution path, not just model
// load — see design §"Ticket 1" acceptance criteria ("runs one inference").
const TINY_ADD_MODEL_BASE64 =
  "CAgSFmJvb2std3JpdGVyLW9ubngtc21va2U6XQoYCgFBCgFCEgFDGghhZGRfbm9kZSIDQWRkEg50aW55X2FkZF9ncmFwaFoPCgFBEgoKCAgBEgQKAggDWg8KAUISCgoICAESBAoCCANiDwoBQxIKCggIARIECgIIA0IECgAQDQ==";

const electronExe = join(unpacked, "Book Writer.exe");
const asarPath = join(unpacked, "resources", "app.asar");
const nativeBindingUnpacked = join(
  unpacked,
  "resources",
  "app.asar.unpacked",
  "node_modules",
  "onnxruntime-node",
  "bin",
  "napi-v6",
  "win32",
  "x64",
);

for (const required of [electronExe, asarPath, nativeBindingUnpacked]) {
  if (!existsSync(required)) throw new Error(`Required packaged path is missing: ${required}`);
}

const bindingNode = join(nativeBindingUnpacked, "onnxruntime_binding.node");
const runtimeDll = join(nativeBindingUnpacked, "onnxruntime.dll");
for (const required of [bindingNode, runtimeDll]) {
  if (!existsSync(required) || !statSync(required).isFile()) throw new Error(`Packaged onnxruntime-node native artifact is missing: ${required}`);
}

// Design §3's open question, resolved: assert the GPU execution-provider
// DLLs did NOT make it into the package (electron-builder.yml excludes
// them). If this ever fails, either the exclusion rule regressed or CPU-only
// inference genuinely started needing them — either way it needs attention,
// not a silent size regression.
const gpuOnlyDlls = ["DirectML.dll", "dxcompiler.dll", "dxil.dll"];
const gpuDllsPresent = gpuOnlyDlls.filter((name) => existsSync(join(nativeBindingUnpacked, name)));

// The worker runs INSIDE the packaged Electron binary via
// ELECTRON_RUN_AS_NODE=1 (Electron's documented headless Node mode: no app
// bootstrap, no BrowserWindow, nothing rendered — safe for an unattended
// CI/agent environment). It requires onnxruntime-node through the real
// app.asar path, exactly as the packaged app's own main-process code would,
// so this is a true test of the packaged artifact, not of the dev
// node_modules tree.
const workerSource = `
"use strict";
const path = require("node:path");
async function main() {
  const unpacked = process.argv[2];
  const modelBase64 = process.argv[3];
  const onnxEntry = path.join(unpacked, "resources", "app.asar", "node_modules", "onnxruntime-node");
  const ort = require(onnxEntry);
  const bytes = Buffer.from(modelBase64, "base64");
  const session = await ort.InferenceSession.create(bytes, { executionProviders: ["cpu"] });
  const A = new ort.Tensor("float32", Float32Array.from([1, 2, 3]), [3]);
  const B = new ort.Tensor("float32", Float32Array.from([10, 20, 30]), [3]);
  const result = await session.run({ A, B });
  process.stdout.write(JSON.stringify({
    ok: true,
    output: Array.from(result.C.data),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    nodeModuleVersion: process.versions.modules,
    isElectronRunAsNode: process.env.ELECTRON_RUN_AS_NODE === "1",
  }) + "\\n");
}
main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String((error && error.stack) || error) }) + "\\n");
  process.exitCode = 1;
});
`;

const workDir = mkdtempSync(join(tmpdir(), "onnx-native-smoke-"));
const workerPath = join(workDir, "worker.cjs");
try {
  writeFileSync(workerPath, workerSource, "utf8");

  let stdout;
  try {
    stdout = execFileSync(electronExe, [workerPath, unpacked, TINY_ADD_MODEL_BASE64], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
    });
  } catch (error) {
    // execFileSync throws on non-zero exit; surface whatever the worker
    // managed to print (it always prints JSON before exiting non-zero) plus
    // the spawn-level error so a hard crash (e.g. missing DLL dependency)
    // is just as diagnosable as a clean JSON failure.
    const partial = error.stdout ? String(error.stdout) : "";
    throw new Error(
      `onnxruntime-node failed to load/run inside the packaged Electron binary (ELECTRON_RUN_AS_NODE=1).\n` +
        `This would mean an electron-rebuild-equivalent step IS required, contradicting the design's` +
        ` napi-v6 ABI-stability assumption.\nstdout: ${partial}\nspawn error: ${error.message}`,
    );
  }

  let result;
  try {
    result = JSON.parse(stdout.trim().split("\n").pop());
  } catch {
    throw new Error(`Worker produced non-JSON output: ${stdout}`);
  }
  if (!result.ok) throw new Error(`Worker inference failed: ${result.error}`);
  const expected = [11, 22, 33];
  if (JSON.stringify(result.output) !== JSON.stringify(expected)) {
    throw new Error(`Inference produced wrong output: got ${JSON.stringify(result.output)}, expected ${JSON.stringify(expected)}`);
  }
  if (!result.isElectronRunAsNode) throw new Error("Worker did not actually run under ELECTRON_RUN_AS_NODE — result is not evidence about the Electron ABI.");

  // Fail, rather than merely report. Their absence is the measured basis for
  // the packaged size, so a rule that silently stopped applying should break
  // the build instead of quietly adding ~38 MB back.
  if (gpuDllsPresent.length > 0) {
    throw new Error(
      `GPU execution-provider DLLs were packaged despite the exclusion rules: ${gpuDllsPresent.join(", ")}. ` +
        `Either electron-builder.yml's onnxruntime-node excludes regressed, or CPU-only inference started requiring them.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        verdict: "onnxruntime-node loads and runs correctly inside the packaged Electron " + result.electronVersion + " build, with NO electron-rebuild-equivalent step.",
        unpacked,
        electronVersion: result.electronVersion,
        nodeVersion: result.nodeVersion,
        nodeModuleVersion: result.nodeModuleVersion,
        inferenceOutput: result.output,
        bindingNodeBytes: statSync(bindingNode).size,
        runtimeDllBytes: statSync(runtimeDll).size,
        gpuOnlyDllsExcludedFromPackage: gpuDllsPresent.length === 0,
        gpuOnlyDllsFoundUnexpectedly: gpuDllsPresent,
        gpuPruningVerdict:
          gpuDllsPresent.length === 0
            ? "CONFIRMED: DirectML.dll/dxcompiler.dll/dxil.dll are excluded from the package and CPU-EP inference still works — the design's §3 open question is resolved: these files ARE prunable."
            : "GPU-only DLLs are present in the package; pruning was not applied or regressed.",
      },
      null,
      2,
    ),
  );
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
