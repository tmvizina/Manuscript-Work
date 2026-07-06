import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { REPO_ROOT } from "./config.js";
import { nowIso, type DB } from "./db/db.js";
import { SKILL_SEED } from "./seed/skills.js";

/** Seed the skills table and refresh description/argument-hint from the live
 * SKILL.md + command files. Seed data owns order/blurb/image; sync owns the rest. */
export function syncSkills(db: DB): { synced: number; missing: string[] } {
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

  for (const seed of SKILL_SEED) {
    const skillMd = join(REPO_ROOT, "skills", seed.skill_id, "SKILL.md");
    let description = "";
    if (existsSync(skillMd)) {
      try {
        description = String(matter(readFileSync(skillMd, "utf-8")).data?.description ?? "");
      } catch {
        // malformed frontmatter -> keep empty description, still list the skill
      }
    } else {
      missing.push(seed.skill_id);
    }

    let argumentHint = "";
    const commandMd = join(REPO_ROOT, ".claude", "commands", `${seed.skill_id}.md`);
    if (existsSync(commandMd)) {
      try {
        argumentHint = String(matter(readFileSync(commandMd, "utf-8")).data?.["argument-hint"] ?? "");
      } catch {
        /* optional */
      }
    }

    upsert.run({
      ...seed,
      description,
      argument_hint: argumentHint,
      image_path: `/skill-art/${seed.skill_id}.svg`,
      has_rag_variant: existsSync(join(REPO_ROOT, "skills-rag", `${seed.skill_id}-rag`, "SKILL.md")) ? 1 : 0,
      synced_at: nowIso(),
    });
  }
  return { synced: SKILL_SEED.length, missing };
}
