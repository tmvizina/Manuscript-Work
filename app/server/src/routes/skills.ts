import type { FastifyInstance } from "fastify";
import type { DB } from "../db/db.js";
import { NONFICTION_SKILL_OVERRIDES, PHASE_LABELS, SIDEBAR_ALIASES } from "../seed/skills.js";
import { MANUSCRIPT_ROOT } from "../config.js";
import { loadProjectProfile } from "../../../../packages/core/src/index.js";
import { syncSkills } from "../skillSync.js";

export default function skillRoutes(app: FastifyInstance, db: DB): void {
  app.get("/api/skills", async () => {
    const rows = db
      .prepare(
        `SELECT skill_id, display_name, pipeline_order, phase, blurb, image_path, has_rag_variant
         FROM skills ORDER BY pipeline_order`,
      )
      .all() as any[];
    // Sidebar = every skill in pipeline order, plus alias placements (the same
    // skill linked into a second phase, e.g. the v2 writer under Generation).
    const nonfiction = loadProjectProfile(MANUSCRIPT_ROOT).config.profile === "nonfiction";
    const displayRows = rows.map((row) => nonfiction && NONFICTION_SKILL_OVERRIDES[row.skill_id] ? { ...row, ...NONFICTION_SKILL_OVERRIDES[row.skill_id] } : row);
    const sidebar = [
      ...displayRows.map((r) => ({ ...r, alias: false })),
      ...SIDEBAR_ALIASES.flatMap((a) => {
        const row = displayRows.find((r) => r.skill_id === a.skill_id);
        return row ? [{ ...row, phase: a.phase, pipeline_order: a.pipeline_order, alias: true }] : [];
      }),
    ].sort((x, y) => x.pipeline_order - y.pipeline_order);
    return { skills: displayRows, sidebar, phase_labels: PHASE_LABELS };
  });

  app.get("/api/skills/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const rawSkill = db.prepare("SELECT * FROM skills WHERE skill_id = ?").get(id) as any;
    const nonfiction = loadProjectProfile(MANUSCRIPT_ROOT).config.profile === "nonfiction";
    const skill = rawSkill && nonfiction && NONFICTION_SKILL_OVERRIDES[id] ? { ...rawSkill, ...NONFICTION_SKILL_OVERRIDES[id] } : rawSkill;
    if (!skill) return reply.code(404).send({ error: "unknown skill" });
    const runs = db
      .prepare(
        `SELECT run_id, variant, prompt, permission_mode, status, result_text, error,
                num_turns, total_cost_usd, input_tokens, output_tokens, created_at, finished_at
         FROM claude_runs WHERE skill_id = ? ORDER BY created_at DESC LIMIT 20`,
      )
      .all(id);
    return { ...skill, runs };
  });

  app.post("/api/skills/sync", async () => syncSkills(db));
}
