/**
 * Renderer-facing data contracts for the first native transport slice.
 *
 * These deliberately mirror the data-only shape exposed by the desktop
 * preload bridge. The HTTP adapter translates the legacy server's snake_case
 * payloads into these types so React does not need to know which runtime it is
 * running in.
 */

export type TransportMode = "http" | "electron";

export type SearchScope = "all" | "chapters" | "world" | "reviews";
export type SearchResultScope = Exclude<SearchScope, "all">;

export interface ProjectSummary {
  projectId: string;
  name: string;
  rootPath: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectDetail extends ProjectSummary {
  manuscriptRoot?: string;
  worldRoot?: string;
  description?: string;
}

export interface ChapterSummary {
  chapterId: string;
  book: string;
  relPath: string;
  number: number;
  title: string;
  wordCount: number;
  active: boolean;
  updatedAt?: string;
}

export interface ChapterDocument extends ChapterSummary {
  text: string;
  sha256?: string;
}

export interface WorldSummary {
  documentId: string;
  relPath: string;
  title?: string;
  updatedAt?: string;
}

export interface WorldDocument extends WorldSummary {
  text: string;
  /** Present for the legacy HTTP route, which renders Markdown server-side. */
  html?: string;
  kind?: "md" | "json";
  bytes?: number;
}

export interface SearchRequest {
  /** HTTP compatibility does not need a project ID; Electron does. */
  projectId?: string;
  query: string;
  scope?: SearchScope;
  limit?: number;
}

export interface SearchResult {
  resultId: string;
  scope: SearchResultScope;
  relPath: string;
  title: string;
  snippet: string;
  score?: number;
}

export interface ChapterReadOptions {
  fresh?: boolean;
}

export interface ProjectTransport {
  list(): Promise<ProjectSummary[]>;
  get(projectId: string): Promise<ProjectDetail | null>;
  open(projectId: string): Promise<ProjectSummary>;
}

export interface ChapterTransport {
  list(projectId?: string): Promise<ChapterSummary[]>;
  get(projectId: string | undefined, chapterId: string, options?: ChapterReadOptions): Promise<ChapterDocument>;
  refresh(projectId?: string): Promise<ChapterSummary[]>;
}

export interface WorldTransport {
  list(projectId?: string): Promise<WorldSummary[]>;
  get(projectId: string | undefined, relPath: string): Promise<WorldDocument>;
}

export interface ContentTransport {
  listChapters(projectId?: string): Promise<ChapterSummary[]>;
  getChapter(projectId: string | undefined, chapterId: string, options?: ChapterReadOptions): Promise<ChapterDocument>;
  listWorld(projectId?: string): Promise<WorldSummary[]>;
  getWorld(projectId: string | undefined, relPath: string): Promise<WorldDocument>;
}

export interface SearchTransport {
  query(request: SearchRequest): Promise<SearchResult[]>;
}

export interface BookWriterTransport {
  readonly mode: TransportMode;
  readonly projects: ProjectTransport;
  readonly content: ContentTransport;
  readonly search: SearchTransport;

  /** Convenience aliases for consumers that do not need the content grouping. */
  readonly chapters: ChapterTransport;
  readonly world: WorldTransport;
}

export type ReadOnlyTransport = BookWriterTransport;
