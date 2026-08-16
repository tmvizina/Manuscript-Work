import { describe, expect, it, vi } from "vitest";
import {
  ProviderPayloadManifestError,
  ProviderPayloadManifestVerifier,
  parseProviderPayloadManifest,
} from "./payloadManifest.js";

const NOW = "2026-08-16T12:00:00.000Z";

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    provider: "claude",
    version: "2.1.226",
    platform: "windows-x64",
    sourceUrl: "https://downloads.example.test/claude-2.1.226.exe",
    license: "Anthropic Commercial Terms",
    publisher: "Anthropic, PBC",
    sha256: "a".repeat(64),
    approval: {
      redistributionApproved: true,
      publisherVerified: true,
      approvedBy: "release-engineering",
      approvedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-12-31T00:00:00.000Z",
    },
    ...overrides,
  };
}

function verifier(readFile = async () => new Uint8Array([1, 2, 3]), sha256 = () => "a".repeat(64)) {
  return new ProviderPayloadManifestVerifier({ readFile, sha256, now: () => NOW });
}

function thrownCode(fn: () => unknown): ProviderPayloadManifestError["code"] {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderPayloadManifestError);
    return (error as ProviderPayloadManifestError).code;
  }
  throw new Error("Expected function to throw a provider payload manifest error");
}

async function rejectedCode(promise: Promise<unknown>): Promise<ProviderPayloadManifestError["code"]> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderPayloadManifestError);
    return (error as ProviderPayloadManifestError).code;
  }
  throw new Error("Expected promise to reject with a provider payload manifest error");
}

describe("provider payload manifest", () => {
  it("parses the strict approved windows-x64 schema and normalizes the digest", () => {
    const parsed = parseProviderPayloadManifest({ ...manifest(), sha256: "B".repeat(64) });
    expect(parsed).toMatchObject({
      schemaVersion: 1,
      provider: "claude",
      version: "2.1.226",
      platform: "windows-x64",
      sha256: "b".repeat(64),
      approval: { redistributionApproved: true, publisherVerified: true },
    });
  });

  it("verifies a local payload through injected read and hash seams", async () => {
    const readFile = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const sha256 = vi.fn(() => "a".repeat(64));
    const result = await verifier(readFile, sha256).verify(manifest(), "C:\\payloads\\claude.exe", {
      provider: "claude",
      version: "2.1.226",
      platform: "windows-x64",
    });
    expect(result).toMatchObject({ payloadPath: "C:\\payloads\\claude.exe", computedSha256: "a".repeat(64) });
    expect(readFile).toHaveBeenCalledWith("C:\\payloads\\claude.exe");
    expect(sha256).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
  });

  it("rejects unknown and missing fields, including nested approval fields", () => {
    expect(thrownCode(() => parseProviderPayloadManifest({ ...manifest(), unexpected: true }))).toBe("manifest_unknown_key");
    const missing = { ...manifest() };
    delete missing.publisher;
    expect(thrownCode(() => parseProviderPayloadManifest(missing))).toBe("manifest_missing_field");
    expect(thrownCode(() => parseProviderPayloadManifest({ ...manifest(), approval: { ...manifest().approval as object, extra: true } }))).toBe("manifest_unknown_key");
  });

  it("rejects malformed, non-HTTPS, and non-windows payload metadata", () => {
    expect(thrownCode(() => parseProviderPayloadManifest("not-json"))).toBe("manifest_parse_failed");
    expect(thrownCode(() => parseProviderPayloadManifest({ ...manifest(), sourceUrl: "http://downloads.example.test/payload.exe" }))).toBe("manifest_field_invalid");
    expect(thrownCode(() => parseProviderPayloadManifest({ ...manifest(), platform: "linux-x64" }))).toBe("manifest_field_invalid");
    expect(thrownCode(() => parseProviderPayloadManifest({ ...manifest(), sha256: "not-a-digest" }))).toBe("manifest_field_invalid");
  });

  it("rejects incomplete approval before any local payload access", async () => {
    const readFile = vi.fn(async () => new Uint8Array([1]));
    const service = verifier(readFile);
    const input = { ...manifest(), approval: { ...(manifest().approval as object), redistributionApproved: false } };
    await expect(rejectedCode(service.verify(input, "C:\\payloads\\claude.exe"))).resolves.toBe("manifest_unapproved");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects stale and not-yet-active approvals", async () => {
    const service = verifier();
    await expect(rejectedCode(service.verify({ ...manifest(), approval: { ...(manifest().approval as object), expiresAt: "2026-08-16T12:00:00.000Z" } }, "payload.exe"))).resolves.toBe("manifest_stale");
    await expect(rejectedCode(service.verify({ ...manifest(), approval: { ...(manifest().approval as object), approvedAt: "2026-08-17T00:00:00.000Z" } }, "payload.exe"))).resolves.toBe("manifest_not_yet_active");
  });

  it("rejects source hosts outside an injected official-host policy", async () => {
    const service = new ProviderPayloadManifestVerifier({
      readFile: async () => new Uint8Array([1]),
      sha256: () => "a".repeat(64),
      now: () => NOW,
      allowedSourceHosts: { claude: ["releases.anthropic.com"] },
    });
    await expect(rejectedCode(service.verify(manifest(), "payload.exe"))).resolves.toBe("manifest_source_unapproved");
  });

  it("rejects provider/version expectation mismatches before reading the payload", async () => {
    const readFile = vi.fn(async () => new Uint8Array([1]));
    const service = verifier(readFile);
    await expect(rejectedCode(service.verify(manifest(), "payload.exe", { provider: "codex" }))).resolves.toBe("manifest_mismatch");
    await expect(rejectedCode(service.verify(manifest(), "payload.exe", { version: "2.1.227" }))).resolves.toBe("manifest_mismatch");
    expect(readFile).not.toHaveBeenCalled();
  });

  it("rejects local read failures and digest mismatches", async () => {
    await expect(rejectedCode(verifier(async () => { throw new Error("offline"); }).verify(manifest(), "payload.exe"))).resolves.toBe("payload_read_failed");
    await expect(rejectedCode(verifier(async () => new Uint8Array([1]), () => "b".repeat(64)).verify(manifest(), "payload.exe"))).resolves.toBe("payload_hash_mismatch");
  });

  it("never accepts an invalid hash returned by the injected hash seam", async () => {
    await expect(rejectedCode(verifier(async () => new Uint8Array([1]), () => "not-a-sha256").verify(manifest(), "payload.exe"))).resolves.toBe("payload_hash_failed");
  });
});
