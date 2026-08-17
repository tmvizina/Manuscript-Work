import { syncSkills as syncContentSkills, type SkillSyncResult } from "../../../packages/core/src/index.js";
import { REPO_ROOT } from "./config.js";
import type { DB } from "./db/db.js";
import { SKILL_SEED } from "./seed/skills.js";

/** Compatibility adapter for the HTTP server. The core service owns the
 * filesystem metadata read; the server supplies its DB and curated seeds. */
export type { SkillSyncResult };

export function syncSkills(db: DB): SkillSyncResult {
  return syncContentSkills(db, { repoRoot: REPO_ROOT, seeds: SKILL_SEED });
}
