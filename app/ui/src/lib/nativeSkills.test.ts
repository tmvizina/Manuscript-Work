import { describe, expect, it } from "vitest";
import { NATIVE_PHASE_LABELS, nativeSkills } from "./nativeSkills";
import type { ProjectProfileConfig } from "../transport";

const nonfictionProfile = {
  schemaVersion: 1,
  profile: "nonfiction",
  preset: "fly-night-fishing",
  editorialMode: "practical-narrative",
  claimsPolicy: "experience-led",
  memoryRoot: "world",
  memoryLabel: "Knowledge Base",
} as ProjectProfileConfig;

describe("native skill sidebar", () => {
  it("lists every skill in pipeline order", () => {
    const items = nativeSkills();
    const orders = items.map((item) => item.pipeline_order);

    expect(items.filter((item) => !item.alias)).toHaveLength(13);
    expect([...orders]).toEqual([...orders].sort((left, right) => left - right));
  });

  it("repeats the v2 writer under Generation, matching the server's alias", () => {
    // The v2 writer drafts during Generation as well as revising, so it is
    // listed in both phases rather than only its home phase.
    const items = nativeSkills();
    const writer = items.filter((item) => item.skill_id === "manuscript-writer-v2");

    expect(writer).toHaveLength(2);
    expect(writer.find((item) => item.alias)?.phase).toBe("generation");
    expect(writer.find((item) => !item.alias)?.phase).toBe("revision");
  });

  it("gives the alias the same display data as its home entry", () => {
    const items = nativeSkills();
    const [alias, home] = [items.find((i) => i.alias), items.find((i) => i.skill_id === "manuscript-writer-v2" && !i.alias)];

    expect(alias?.display_name).toBe(home?.display_name);
    expect(alias?.image_path).toBe(home?.image_path);
    expect(alias?.blurb).toBe(home?.blurb);
  });

  it("applies nonfiction naming to the alias as well as the home entry", () => {
    // A stale label on the duplicate would show two different names for one
    // skill in the same sidebar.
    const items = nativeSkills(nonfictionProfile);
    const writer = items.filter((item) => item.skill_id === "manuscript-writer-v2");

    expect(writer).toHaveLength(2);
    expect(new Set(writer.map((item) => item.display_name))).toEqual(new Set(["Nonfiction Writer v2"]));
  });

  it("covers every phase it emits with a label", () => {
    for (const item of nativeSkills()) {
      expect(NATIVE_PHASE_LABELS[item.phase]).toBeTruthy();
    }
  });
});
