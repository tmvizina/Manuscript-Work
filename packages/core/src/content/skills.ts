import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ContentDatabase, nowIso, rootValue } from "./common.js";

export interface SkillSeed {
  skill_id: string;
  display_name: string;
  pipeline_order: number;
  phase: string;
  blurb: string;
}

export interface SkillMetadata {
  description: string;
  argument_hint: string;
  has_rag_variant: number;
  missing: boolean;
}

export interface SkillSyncResult {
  synced: number;
  missing: string[];
}

export interface SkillSyncOptions {
  repoRoot: string;
  seeds: readonly SkillSeed[];
}

/** Parse the simple scalar frontmatter used by SKILL.md files without adding a
 * gray-matter dependency to the shared content package. */
export function parseFrontmatter(text: string): Record<string, string> {
  const source = text.replace(/^\uFEFF/, "");
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) return {};
  const lines = source.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return {};

  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = value;
  }
  return fields;
}

export function readSkillMetadata(seed: SkillSeed, repoRoot: string): SkillMetadata {
  const root = rootValue(repoRoot, "repoRoot");
  const skillMd = join(root, "skills", seed.skill_id, "SKILL.md");
  let description = "";
  let missing = false;
  if (existsSync(skillMd)) {
    try {
      description = String(parseFrontmatter(readFileSync(skillMd, "utf-8")).description ?? "");
    } catch {
      // Keep the skill listed when a file is unreadable or malformed.
    }
  } else {
    missing = true;
  }

  let argument_hint = "";
  const commandMd = join(root, ".claude", "commands", `${seed.skill_id}.md`);
  if (existsSync(commandMd)) {
    try {
      argument_hint = String(parseFrontmatter(readFileSync(commandMd, "utf-8"))["argument-hint"] ?? "");
    } catch {
      // The command file is optional metadata.
    }
  }

  return {
    description,
    argument_hint,
    has_rag_variant: existsSync(join(root, "skills-rag", `${seed.skill_id}-rag`, "SKILL.md")) ? 1 : 0,
    missing,
  };
}

/** Sync skill metadata while leaving curated seed order/blurbs owned by the
 * caller. Stable skill IDs are supplied by the existing server seed list. */
export function syncSkills(db: ContentDatabase, options: SkillSyncOptions): SkillSyncResult {
  const root = rootValue(options.repoRoot, "repoRoot");
  const missing: string[] = [];
  const upsert = db.prepare(`
    INSERT INTO skills (skill_id, display_name, pipeline_order, phase, blurb, description,
                        argument_hint, image_path, has_rag_variant, synced_at)
    VALUES (@skill_id, @display_name, @pipeline_order, @phase, @blurb, @description,
            @argument_hint, @image_path, @has_rag_variant, @synced_at)
    ON CONFLICT(skill_id) DO UPDATE SET
      display_name = excluded.display_name,
      pipeline_order = excluded.pipeline_order,
      phase = excluded.phase,
      blurb = excluded.blurb,
      description = excluded.description,
      argument_hint = excluded.argument_hint,
      image_path = excluded.image_path,
      has_rag_variant = excluded.has_rag_variant,
      synced_at = excluded.synced_at
  `);

  for (const seed of options.seeds) {
    const metadata = readSkillMetadata(seed, root);
    if (metadata.missing) missing.push(seed.skill_id);
    upsert.run({
      ...seed,
      description: metadata.description,
      argument_hint: metadata.argument_hint,
      image_path: `/skill-art/${seed.skill_id}.svg`,
      has_rag_variant: metadata.has_rag_variant,
      synced_at: nowIso(),
    });
  }
  return { synced: options.seeds.length, missing };
}
