import type { DB } from "./db.js";
import { nowIso } from "./db.js";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

interface ProjectSettingRow {
  project_id: string;
  key: string;
  value_json: string;
  updated_at: string;
}
export interface ProjectSettingRecord {
  projectId: string;
  key: string;
  value: JsonValue;
  updatedAt: string;
}

function mapSetting(row: ProjectSettingRow): ProjectSettingRecord {
  return {
    projectId: row.project_id,
    key: row.key,
    value: JSON.parse(row.value_json) as JsonValue,
    updatedAt: row.updated_at,
  };
}

export function getProjectSetting(db: DB, projectId: string, key: string): ProjectSettingRecord | null {
  const row = db.prepare(
    "SELECT project_id, key, value_json, updated_at FROM project_settings WHERE project_id = ? AND key = ?",
  ).get(projectId, key) as ProjectSettingRow | undefined;
  return row ? mapSetting(row) : null;
}

export function setProjectSetting(db: DB, projectId: string, key: string, value: JsonValue): ProjectSettingRecord {
  const updatedAt = nowIso();
  const valueJson = JSON.stringify(value);
  db.prepare(
    `INSERT INTO project_settings(project_id, key, value_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id, key) DO UPDATE SET
       value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
  ).run(projectId, key, valueJson, updatedAt);
  return { projectId, key, value, updatedAt };
}
