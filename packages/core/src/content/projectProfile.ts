import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isPathInside } from "./paths.js";

export const PROJECT_CONFIG_REL_PATH = ".book-writer/project.json";
export const PROJECT_PROFILES = ["fantasy", "nonfiction"] as const;
export type ProjectProfileId = (typeof PROJECT_PROFILES)[number];
export const PROJECT_PRESETS = ["fly-night-fishing"] as const;
export type ProjectPresetId = (typeof PROJECT_PRESETS)[number];
export type EditorialMode = "narrative" | "practical-narrative";
export type ClaimsPolicy = "canon" | "experience-led";

export interface ProjectProfileConfig {
  schemaVersion: 1;
  profile: ProjectProfileId;
  preset?: ProjectPresetId;
  editorialMode: EditorialMode;
  claimsPolicy: ClaimsPolicy;
  memoryRoot: "world";
  memoryLabel: "World" | "Knowledge Base";
}

export interface ProjectProfileResult {
  config: ProjectProfileConfig;
  source: "default" | "project";
  configPath: string;
}

export interface ScaffoldProjectProfileInput {
  profile: ProjectProfileId;
  preset?: ProjectPresetId;
}

export interface ScaffoldProjectProfileResult extends ProjectProfileResult {
  created: string[];
  preserved: string[];
}

export class ProjectProfileError extends Error {
  constructor(message: string, readonly configPath: string) {
    super(message);
    this.name = "ProjectProfileError";
  }
}

const FANTASY_DEFAULT: ProjectProfileConfig = Object.freeze({
  schemaVersion: 1, profile: "fantasy", editorialMode: "narrative", claimsPolicy: "canon", memoryRoot: "world", memoryLabel: "World",
});
const FISHING_DEFAULT: ProjectProfileConfig = Object.freeze({
  schemaVersion: 1, profile: "nonfiction", preset: "fly-night-fishing", editorialMode: "practical-narrative", claimsPolicy: "experience-led", memoryRoot: "world", memoryLabel: "Knowledge Base",
});

export const PROFILE_GROUP_LABELS: Readonly<Record<ProjectProfileId, Readonly<Record<string, string>>>> = Object.freeze({
  fantasy: Object.freeze({ "": "World", characters: "Characters", locations: "Locations", factions: "Factions", "magic-and-objects": "Magic & Objects", threads: "Threads", timeline: "Timeline", continuity: "Continuity", "voice-bible": "Voice Bible" }),
  nonfiction: Object.freeze({ "": "Knowledge Base", author: "Author & Voice", audience: "Audience", topics: "Topics", techniques: "Techniques", equipment: "Equipment", species: "Species", conditions: "Conditions", places: "Places", people: "People", stories: "Stories", "safety-and-regulations": "Safety & Regulations", terminology: "Terminology", claims: "Claims", sources: "Sources", continuity: "Continuity", _intake: "Intake Archive" }),
});

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function configPath(projectRoot: string): string { return join(resolve(projectRoot), ...PROJECT_CONFIG_REL_PATH.split("/")); }
function assertProjectRoot(projectRoot: string): string {
  const root = resolve(projectRoot);
  if (!existsSync(root)) throw new ProjectProfileError("Project root does not exist", configPath(root));
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProjectProfileError("Project root must be a physical directory", configPath(root));
  return realpathSync(root);
}

function parseConfig(value: unknown, path: string): ProjectProfileConfig {
  if (!isRecord(value)) throw new ProjectProfileError("Project configuration must be a JSON object", path);
  const allowed = new Set(["schemaVersion", "profile", "preset", "editorialMode", "claimsPolicy", "memoryRoot", "memoryLabel"]);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new ProjectProfileError("Project configuration contains unsupported fields", path);
  if (value.schemaVersion !== 1) throw new ProjectProfileError("Unsupported project configuration schemaVersion", path);
  if (value.profile !== "fantasy" && value.profile !== "nonfiction") throw new ProjectProfileError("profile must be fantasy or nonfiction", path);
  if (value.memoryRoot !== "world") throw new ProjectProfileError("memoryRoot must be world", path);
  if (value.profile === "fantasy") {
    if (value.preset !== undefined) throw new ProjectProfileError("Fantasy projects do not accept a preset", path);
    if (value.editorialMode !== "narrative" || value.claimsPolicy !== "canon" || value.memoryLabel !== "World") throw new ProjectProfileError("Fantasy profile fields do not match the supported defaults", path);
    return { ...FANTASY_DEFAULT };
  }
  if (value.preset !== "fly-night-fishing") throw new ProjectProfileError("Unsupported nonfiction preset", path);
  if (value.editorialMode !== "practical-narrative" || value.claimsPolicy !== "experience-led" || value.memoryLabel !== "Knowledge Base") throw new ProjectProfileError("Nonfiction profile fields do not match the fly-night-fishing preset", path);
  return { ...FISHING_DEFAULT };
}

export function defaultProjectProfile(): ProjectProfileConfig { return { ...FANTASY_DEFAULT }; }
export function projectProfileFor(input: ScaffoldProjectProfileInput): ProjectProfileConfig {
  if (input.profile === "fantasy") {
    if (input.preset !== undefined) throw new TypeError("Fantasy projects do not accept a preset");
    return { ...FANTASY_DEFAULT };
  }
  if (input.preset !== "fly-night-fishing") throw new TypeError("Nonfiction projects require the fly-night-fishing preset");
  return { ...FISHING_DEFAULT };
}

export function loadProjectProfile(projectRoot: string): ProjectProfileResult {
  const root = assertProjectRoot(projectRoot);
  const path = configPath(root);
  if (!existsSync(path)) return { config: defaultProjectProfile(), source: "default", configPath: path };
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || !isPathInside(root, realpathSync(path), false)) throw new ProjectProfileError("Project configuration must be a physical file inside the project", path);
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf-8")); }
  catch (error) { throw new ProjectProfileError(`Project configuration is not valid JSON: ${error instanceof Error ? error.message : "unknown error"}`, path); }
  return { config: parseConfig(parsed, path), source: "project", configPath: path };
}

const FISHING_FILES: Readonly<Record<string, string>> = Object.freeze({
  "world/README.md": "# Knowledge Base\n\nThis folder is the nonfiction memory system for the book. Treat firsthand experience as attributed experience, never invent events, and flag safety or regulation claims for dated jurisdiction-specific verification.\n",
  "world/author/voice-profile.md": "# Author Voice Profile\n\n- **Expertise and experience:** TBD\n- **Natural cadence and vocabulary:** TBD\n- **Claims the author is comfortable making:** TBD\n- **Boundaries—what the author will not claim:** TBD\n",
  "world/audience/reader-profile.md": "# Reader Profile\n\n- **Primary reader:** TBD\n- **Starting knowledge:** TBD\n- **What the reader should be able to do:** TBD\n",
  "world/topics/topic-map.md": "# Topic Map\n\nUse stable `TOP-NNN` IDs. Record prerequisites and the chapters that teach or reinforce each topic.\n",
  "world/stories/story-ledger.md": "# Story Ledger\n\nUse stable `ANE-NNN` IDs. Label each entry as firsthand observation, recollection, interview account, or open question. Never fill gaps by invention.\n",
  "world/safety-and-regulations/verification-ledger.md": "# Safety and Regulations Verification Ledger\n\nRecord jurisdiction, checked date, source, and verification status for every safety, legal, access, or fishing-regulation claim.\n",
  "world/terminology/glossary.md": "# Fishing Glossary\n\nUse the author's preferred terminology consistently and note regional alternatives.\n",
  "world/claims/claims-ledger.md": "# Claims Ledger\n\nUse stable `CLM-NNN` IDs. Distinguish personal experience from general advice. General safety, legal, scientific, and regulation claims require verification.\n",
  "world/sources/source-register.md": "# Source Register\n\nUse stable `SRC-NNN` IDs. Sources may include the author's field notes, interviews, publications, agency guidance, and regulations.\n",
  "world/continuity/decision-ledger.md": "# Decision Ledger\n\nRecord terminology, scope, structural, and factual decisions that must remain consistent across chapters.\n",
});
const FISHING_DIRECTORIES = ["techniques", "equipment", "species", "conditions", "places", "people", "_intake"] as const;

function writeNewFile(root: string, relPath: string, content: string, created: string[], preserved: string[]): void {
  const path = join(root, ...relPath.split("/"));
  if (!isPathInside(root, path, false)) throw new ProjectProfileError("Scaffold path escaped the project", path);
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isPathInside(root, realpathSync(path), false)) throw new ProjectProfileError("Existing scaffold target is not a physical project file", path);
    preserved.push(relPath);
    return;
  }
  ensureSafeDirectory(root, dirname(relPath).replaceAll("\\", "/"));
  writeFileSync(path, content, { encoding: "utf-8", flag: "wx" });
  created.push(relPath);
}

function ensureSafeDirectory(root: string, relPath: string): void {
  let current = root;
  for (const segment of relPath.split("/").filter(Boolean)) {
    current = join(current, segment);
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !isPathInside(root, realpathSync(current), true)) throw new ProjectProfileError("Scaffold directory is not physically contained in the project", current);
    } else {
      mkdirSync(current);
    }
  }
}

export function scaffoldProjectProfile(projectRoot: string, input: ScaffoldProjectProfileInput): ScaffoldProjectProfileResult {
  const root = assertProjectRoot(projectRoot);
  const config = projectProfileFor(input);
  const created: string[] = [];
  const preserved: string[] = [];
  const existingConfigPath = configPath(root);
  const hasExistingConfig = existsSync(existingConfigPath);
  if (hasExistingConfig) {
    const existing = loadProjectProfile(root).config;
    if (existing.profile !== config.profile || existing.preset !== config.preset) {
      throw new ProjectProfileError("Existing project configuration selects a different profile or preset", existingConfigPath);
    }
    preserved.push(PROJECT_CONFIG_REL_PATH);
  }
  if (config.profile === "nonfiction") {
    for (const directory of FISHING_DIRECTORIES) ensureSafeDirectory(root, `world/${directory}`);
    for (const [relPath, content] of Object.entries(FISHING_FILES)) writeNewFile(root, relPath, content, created, preserved);
  }
  if (!hasExistingConfig) writeNewFile(root, PROJECT_CONFIG_REL_PATH, `${JSON.stringify(config, null, 2)}\n`, created, preserved);
  return { config, source: "project", configPath: configPath(root), created, preserved };
}
