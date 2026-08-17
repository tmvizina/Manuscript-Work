import { join, resolve } from "node:path";
import type { DB } from "./db.js";
import { newId, nowIso } from "./db.js";

interface ProjectRow {
  project_id: string;
  name: string;
  root_path: string;
  created_at: string;
  updated_at: string;
  active: number;
}
export interface ProjectRecord {
  projectId: string;
  name: string;
  rootPath: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail extends ProjectRecord {
  manuscriptRoot: string;
  worldRoot: string;
}

export interface CreateProjectInput {
  projectId?: string;
  name: string;
  rootPath: string;
  active?: boolean;
}

const PROJECT_COLUMNS = "project_id, name, root_path, created_at, updated_at, active";

function mapProject(row: ProjectRow): ProjectRecord {
  return {
    projectId: row.project_id,
    name: row.name,
    rootPath: resolve(row.root_path),
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function detail(project: ProjectRecord): ProjectDetail {
  return {
    ...project,
    manuscriptRoot: project.rootPath,
    worldRoot: join(project.rootPath, "world"),
  };
}

/** Register a trusted manuscript root. Callers must obtain the path outside the renderer. */
export function createProject(db: DB, input: CreateProjectInput): ProjectDetail {
  const timestamp = nowIso();
  const projectId = input.projectId ?? newId("project");
  const rootPath = resolve(input.rootPath);
  db.prepare(
    `INSERT INTO projects(project_id, name, root_path, created_at, updated_at, active)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(projectId, input.name, rootPath, timestamp, timestamp, input.active === false ? 0 : 1);
  return detail({
    projectId,
    name: input.name,
    rootPath,
    active: input.active !== false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function listProjects(db: DB, options: { includeInactive?: boolean } = {}): ProjectRecord[] {
  const rows = (options.includeInactive
    ? db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY active DESC, updated_at DESC, project_id`).all()
    : db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE active = 1 ORDER BY updated_at DESC, project_id`).all()) as ProjectRow[];
  return rows.map(mapProject);
}

export function getProject(db: DB, projectId: string): ProjectDetail | null {
  const row = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE project_id = ?`).get(projectId) as
    | ProjectRow
    | undefined;
  return row ? detail(mapProject(row)) : null;
}

/**
 * Resolve an existing active project and record recent use. This never accepts
 * a renderer-supplied path; the returned root comes exclusively from storage.
 */
export function openProject(db: DB, projectId: string): ProjectDetail | null {
  const row = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE project_id = ? AND active = 1`).get(projectId) as
    | ProjectRow
    | undefined;
  if (!row) return null;
  const updatedAt = nowIso();
  db.prepare("UPDATE projects SET updated_at = ? WHERE project_id = ?").run(updatedAt, projectId);
  return detail(mapProject({ ...row, updated_at: updatedAt }));
}
