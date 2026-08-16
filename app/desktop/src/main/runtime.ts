import {
  createAgentRun,
  createProject as createStoredProject,
  finishAgentRun,
  getAgentRun,
  getProject as getStoredProject,
  getProjectChapter,
  getProjectSetting,
  listProjectChapters,
  listProjects,
  listAgentRuns,
  listWorld as scanWorldDocuments,
  loadProjectProfile,
  markAgentRunStarted,
  openDb,
  openProject as openStoredProject,
  readWorldFile,
  readReviewFile,
  scanReviewDocs,
  scaffoldProjectProfile,
  resolveOrphanedAgentRuns,
  searchProject,
  SearchInputError,
  setProjectSetting,
  syncProjectChapters,
  type AgentRunRecord,
  type DB,
  type ProjectDetail as CoreProjectDetail,
} from "@book-writer/core";
import { basename, resolve } from "node:path";
import { PROJECT_SETTING_KEYS } from "../shared/contracts.js";
import type {
  AuthResult,
  AuthCancelResult,
  ChapterDocument,
  ChapterSummary,
  ExecutionProvider,
  ProjectDetail,
  ProjectImportInput,
  ProjectSummary,
  ProviderSummary,
  RunAccepted,
  RunCancelResult,
  RunEventDelivery,
  RunRecord,
  RunListRequest,
  ReviewDocument,
  ReviewSummary,
  RunRequest,
  RunSubscribeRequest,
  RunSubscriptionAccepted,
  RunUnsubscribeResult,
  SearchRequest,
  SearchResult,
  SettingRecord,
  SettingValue,
  WorldDocument,
  WorldSummary,
} from "../shared/contracts.js";
import { BookWriterError, IPC_ERROR_CODES } from "../shared/errors.js";
import { assertProjectSettingValue } from "../shared/validation.js";
import type { DesktopRuntime } from "./ipc.js";
import { RunManager } from "./runs/manager.js";
import type { ProviderRunner, RunPersistence } from "./runs/contracts.js";
import { NativeCliRunner } from "./runs/nativeCliRunner.js";
import { ProviderDiscovery } from "./providers/discovery.js";
import { ProviderAuthentication } from "./providers/authentication.js";

export interface NativeDesktopRuntimeOptions {
  runner?: ProviderRunner;
  providerDiscovery?: ProviderDiscovery;
  providerAuthentication?: ProviderAuthentication;
  databaseBackupDirectory?: string;
}

function notFound(entity: string, operation: string): never {
  throw new BookWriterError({ code: IPC_ERROR_CODES.notFound, message: `${entity} was not found`, operation });
}

function mapProject(project: CoreProjectDetail): ProjectDetail {
  const profile = loadProjectProfile(project.rootPath);
  return {
    projectId: project.projectId,
    name: project.name,
    rootPath: project.rootPath,
    active: project.active,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    manuscriptRoot: project.manuscriptRoot,
    worldRoot: project.worldRoot,
    profile: profile.config,
    profileSource: profile.source,
  };
}

function mapProjectSummary(project: CoreProjectDetail): ProjectSummary {
  return {
    projectId: project.projectId,
    name: project.name,
    rootPath: project.rootPath,
    active: project.active,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function mapRun(run: AgentRunRecord): RunRecord {
  const usage: NonNullable<RunRecord["usage"]> = {};
  if (run.usage.inputTokens !== undefined) usage.inputTokens = run.usage.inputTokens;
  if (run.usage.outputTokens !== undefined) usage.outputTokens = run.usage.outputTokens;
  if (run.usage.durationMs !== undefined) usage.durationMs = run.usage.durationMs;
  if (run.usage.totalCostUsd !== undefined) usage.totalCostUsd = run.usage.totalCostUsd;
  return {
    runId: run.runId,
    projectId: run.projectId,
    provider: run.provider,
    ...(run.model === null ? {} : { model: run.model }),
    skillId: run.skillId,
    variant: run.variant,
    status: run.status,
    prompt: run.prompt,
    resultText: run.resultText,
    ...(run.error === null ? {} : { error: run.error }),
    ...(Object.keys(usage).length === 0 ? {} : { usage }),
    createdAt: run.createdAt,
    ...(run.startedAt === null ? {} : { startedAt: run.startedAt }),
    ...(run.finishedAt === null ? {} : { finishedAt: run.finishedAt }),
  };
}

export class NativeDesktopRuntime implements DesktopRuntime {
  readonly db: DB;
  private readonly runs: RunManager;
  private readonly providerDiscovery: ProviderDiscovery;
  private readonly providerAuthentication: ProviderAuthentication;

  constructor(dbPath: string, options: NativeDesktopRuntimeOptions = {}) {
    this.db = openDb(dbPath, options.databaseBackupDirectory ? { backupDirectory: options.databaseBackupDirectory } : {});
    this.providerDiscovery = options.providerDiscovery ?? new ProviderDiscovery();
    this.providerAuthentication = options.providerAuthentication ?? new ProviderAuthentication({ discovery: this.providerDiscovery });
    resolveOrphanedAgentRuns(this.db);
    const persistence: RunPersistence = {
      createRun: (input) => mapRun(createAgentRun(this.db, {
        runId: input.runId,
        projectId: input.projectId,
        provider: input.provider,
        model: input.model,
        skillId: input.skillId,
        variant: input.variant,
        permissionMode: input.permissionMode,
        prompt: input.prompt,
      })),
      getRun: (runId) => {
        const run = getAgentRun(this.db, runId);
        return run ? mapRun(run) : null;
      },
      markRunStarted: (runId) => {
        markAgentRunStarted(this.db, runId);
      },
      finishRun: (runId, input) => {
        finishAgentRun(this.db, runId, {
          status: input.status,
          resultText: input.resultText,
          error: input.error,
          usage: input.usage,
        });
      },
    };
    const runner = options.runner ?? new NativeCliRunner({
      discovery: this.providerDiscovery,
      resolveCwd: (request) => request.projectId
        ? this.requireProject(request.projectId, "runs.start").rootPath
        : process.cwd(),
    });
    this.runs = new RunManager({ runner, persistence });
  }

  async close(): Promise<void> {
    this.providerAuthentication.cancelAll();
    await this.runs.shutdown();
    this.db.close();
  }

  private requireProject(projectId: string, operation: string): CoreProjectDetail {
    const project = getStoredProject(this.db, projectId);
    if (!project || !project.active) notFound("Project", operation);
    return project;
  }

  private syncChapters(project: CoreProjectDetail): void {
    this.db.transaction(() => syncProjectChapters(this.db, project))();
  }

  listProviders(): Promise<ProviderSummary[]> {
    return this.providerDiscovery.scan();
  }

  getProviderStatus(provider?: ExecutionProvider): Promise<ProviderSummary[]> {
    return this.providerDiscovery.scan(provider);
  }

  selectProviderExecutable(provider: ExecutionProvider, executablePath: string): Promise<ProviderSummary> {
    return this.providerDiscovery.selectExecutable(provider, executablePath);
  }

  authenticateProvider(provider: ExecutionProvider): Promise<AuthResult> {
    return this.providerAuthentication.authenticate(provider);
  }

  cancelProviderAuthentication(provider: ExecutionProvider): AuthCancelResult {
    return { provider, cancelled: this.providerAuthentication.cancel(provider) };
  }

  listProjects(): ProjectSummary[] {
    return listProjects(this.db).map((project) => ({
      projectId: project.projectId,
      name: project.name,
      rootPath: project.rootPath,
      active: project.active,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    }));
  }

  getProject(projectId: string): ProjectDetail | null {
    const project = getStoredProject(this.db, projectId);
    return project ? mapProject(project) : null;
  }

  openProject(projectId: string): ProjectSummary {
    const project = openStoredProject(this.db, projectId);
    if (!project) notFound("Project", "projects.open");
    this.syncChapters(project);
    return mapProjectSummary(project);
  }

  importProject(rootPath: string, input: ProjectImportInput): ProjectDetail {
    const resolved = resolve(rootPath);
    const existing = listProjects(this.db, { includeInactive: true }).find((project) => project.rootPath === resolved);
    if (existing) {
      const detail = getStoredProject(this.db, existing.projectId);
      if (!detail) notFound("Project", "projects.import");
      const current = loadProjectProfile(detail.rootPath).config;
      if (current.profile !== input.profile || current.preset !== input.preset) {
        throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "The folder is already registered with a different project profile", operation: "projects.import" });
      }
      return mapProject(detail);
    }
    scaffoldProjectProfile(resolved, input);
    const project = createStoredProject(this.db, { name: basename(resolved), rootPath: resolved });
    this.syncChapters(project);
    return mapProject(project);
  }

  listChapters(projectId: string): ChapterSummary[] {
    const project = this.requireProject(projectId, "content.listChapters");
    this.syncChapters(project);
    return listProjectChapters(this.db, projectId).map((chapter) => ({
      chapterId: chapter.chapterId,
      book: chapter.book,
      relPath: chapter.relPath,
      number: chapter.number,
      title: chapter.title,
      wordCount: chapter.wordCount,
      active: chapter.active,
      updatedAt: chapter.syncedAt,
    }));
  }

  getChapter(projectId: string, chapterId: string): ChapterDocument {
    const project = this.requireProject(projectId, "content.getChapter");
    this.syncChapters(project);
    const chapter = getProjectChapter(this.db, projectId, chapterId);
    if (!chapter || !chapter.active) notFound("Chapter", "content.getChapter");
    return {
      chapterId: chapter.chapterId,
      book: chapter.book,
      relPath: chapter.relPath,
      number: chapter.number,
      title: chapter.title,
      wordCount: chapter.wordCount,
      active: chapter.active,
      updatedAt: chapter.syncedAt,
      text: chapter.text,
      sha256: chapter.sha256,
    };
  }

  listWorld(projectId: string): WorldSummary[] {
    const project = this.requireProject(projectId, "content.listWorld");
    return scanWorldDocuments(project.rootPath).groups.flatMap((group) =>
      group.files.map((file) => ({
        documentId: `world:${file.rel_path}`,
        relPath: file.rel_path,
        title: file.name,
      })),
    );
  }

  getWorld(projectId: string, relPath: string): WorldDocument {
    const project = this.requireProject(projectId, "content.getWorld");
    const document = readWorldFile(project.rootPath, relPath);
    if (!document) notFound("World document", "content.getWorld");
    return {
      documentId: `world:${document.rel_path}`,
      relPath: document.rel_path,
      title: document.rel_path.split("/").at(-1),
      updatedAt: document.mtime,
      text: document.text,
    };
  }

  listReviews(projectId: string): ReviewSummary[] {
    const project = this.requireProject(projectId, "content.listReviews");
    return scanReviewDocs(project.rootPath).map((document) => ({ relPath: document.rel_path, name: document.name, ext: document.ext, kind: document.kind, date: document.date, scope: document.scope, title: document.title, updatedAt: document.mtime, stats: document.stats as ReviewSummary["stats"] }));
  }

  getReview(projectId: string, relPath: string): ReviewDocument {
    const project = this.requireProject(projectId, "content.getReview");
    const document = readReviewFile(project.rootPath, relPath);
    if (!document) notFound("Review document", "content.getReview");
    return { relPath: document.rel_path, kind: document.kind, updatedAt: document.mtime, bytes: document.bytes, text: document.text };
  }

  startRun(request: RunRequest): Promise<RunAccepted> {
    if (request.projectId) this.requireProject(request.projectId, "runs.start");
    return this.runs.startRun(request);
  }

  getRun(runId: string): Promise<RunRecord> {
    return this.runs.getRun(runId);
  }

  listRuns(request: RunListRequest = {}): RunRecord[] {
    if (request.projectId) this.requireProject(request.projectId, "runs.list");
    return listAgentRuns(this.db, request).map(mapRun);
  }

  cancelRun(runId: string): Promise<RunCancelResult> {
    return this.runs.cancelRun(runId);
  }

  subscribeRun(
    request: RunSubscribeRequest,
    _deliver: (delivery: RunEventDelivery) => void,
  ): Promise<RunSubscriptionAccepted> {
    return this.runs.subscribeRun(request, _deliver);
  }

  unsubscribeRun(subscriptionId: string): Promise<RunUnsubscribeResult> {
    return this.runs.unsubscribeRun(subscriptionId);
  }

  search(request: SearchRequest): SearchResult[] {
    const project = this.requireProject(request.projectId, "search.query");
    try {
      return searchProject(project.rootPath, {
        query: request.query,
        ...(request.scope === undefined ? {} : { scope: request.scope }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      });
    } catch (error) {
      if (error instanceof SearchInputError) {
        throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: error.message, operation: "search.query" });
      }
      throw error;
    }
  }

  getSetting(projectId: string, key: string): SettingRecord | null {
    this.requireProject(projectId, "settings.get");
    if (!(PROJECT_SETTING_KEYS as readonly string[]).includes(key)) {
      throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message: "setting key is not allowed", operation: "settings.get" });
    }
    return getProjectSetting(this.db, projectId, key);
  }

  setSetting(projectId: string, key: string, value: SettingValue): SettingRecord {
    this.requireProject(projectId, "settings.set");
    assertProjectSettingValue(key, value, "settings.set");
    return setProjectSetting(this.db, projectId, key, value);
  }
}
