import {
  getAgentRun,
  getProject as getStoredProject,
  getProjectChapter,
  getProjectSetting,
  listProjectChapters,
  listProjects,
  listWorld as scanWorldDocuments,
  newId,
  openDb,
  openProject as openStoredProject,
  readWorldFile,
  resolveOrphanedAgentRuns,
  searchProject,
  SearchInputError,
  setProjectSetting,
  syncProjectChapters,
  type AgentRunRecord,
  type DB,
  type ProjectDetail as CoreProjectDetail,
} from "@book-writer/core";
import { PROJECT_SETTING_KEYS } from "../shared/contracts.js";
import type {
  ChapterDocument,
  ChapterSummary,
  ExecutionProvider,
  ProjectDetail,
  ProjectSummary,
  ProviderSummary,
  RunAccepted,
  RunCancelResult,
  RunEventDelivery,
  RunRecord,
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

function notFound(entity: string, operation: string): never {
  throw new BookWriterError({ code: IPC_ERROR_CODES.notFound, message: `${entity} was not found`, operation });
}

function featureUnavailable(operation: string): never {
  throw new BookWriterError({
    code: IPC_ERROR_CODES.featureUnavailable,
    message: "Provider execution is unavailable until the native runner is configured",
    operation,
  });
}

function mapProject(project: CoreProjectDetail): ProjectDetail {
  return {
    projectId: project.projectId,
    name: project.name,
    rootPath: project.rootPath,
    active: project.active,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    manuscriptRoot: project.manuscriptRoot,
    worldRoot: project.worldRoot,
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

function providerUnavailable(provider: ExecutionProvider): ProviderSummary {
  return {
    provider,
    status: "unavailable",
    message: "Provider discovery and authentication are scheduled for Phase 4",
    checkedAt: new Date().toISOString(),
  };
}

export class NativeDesktopRuntime implements DesktopRuntime {
  readonly db: DB;
  private readonly subscriptions = new Set<string>();

  constructor(dbPath: string) {
    this.db = openDb(dbPath);
    resolveOrphanedAgentRuns(this.db);
  }

  close(): void {
    this.subscriptions.clear();
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

  listProviders(): ProviderSummary[] {
    return [providerUnavailable("claude"), providerUnavailable("codex")];
  }

  getProviderStatus(provider?: ExecutionProvider): ProviderSummary[] {
    return provider ? [providerUnavailable(provider)] : this.listProviders();
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

  startRun(_request: RunRequest): RunAccepted {
    return featureUnavailable("runs.start");
  }

  getRun(runId: string): RunRecord {
    const run = getAgentRun(this.db, runId);
    if (!run) notFound("Run", "runs.get");
    return mapRun(run);
  }

  cancelRun(runId: string): RunCancelResult {
    if (!getAgentRun(this.db, runId)) notFound("Run", "runs.cancel");
    return { runId, cancelled: false };
  }

  subscribeRun(
    request: RunSubscribeRequest,
    _deliver: (delivery: RunEventDelivery) => void,
  ): RunSubscriptionAccepted {
    if (!getAgentRun(this.db, request.runId)) notFound("Run", "runs.subscribe");
    const subscriptionId = newId("subscription");
    this.subscriptions.add(subscriptionId);
    return {
      subscriptionId,
      runId: request.runId,
      replayCursor: request.afterSequence ?? -1,
      replayTruncated: false,
      replay: [],
    };
  }

  unsubscribeRun(subscriptionId: string): RunUnsubscribeResult {
    return { subscriptionId, unsubscribed: this.subscriptions.delete(subscriptionId) };
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
