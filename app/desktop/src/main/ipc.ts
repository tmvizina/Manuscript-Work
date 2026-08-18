import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import {
  IPC_CHANNELS,
  type AuthResult,
  type AuthCancelResult,
  type ChapterDocument,
  type ChapterSummary,
  type ExecutionProvider,
  type IpcResponse,
  type InstallResult,
  type InstallSource,
  type ProjectDetail,
  type ProjectImportInput,
  type ProjectSummary,
  type ProviderSummary,
  type RunAccepted,
  type RunCancelResult,
  type RunEventDelivery,
  type RunRecord,
  type RunListRequest,
  type ReviewDocument,
  type ReviewSummary,
  type RunRequest,
  type RunSubscribeRequest,
  type RunSubscriptionAccepted,
  type RunUnsubscribeResult,
  type HelpDocument,
  type HelpSectionSummary,
  type RagProgressEvent,
  type RagQueryResponse,
  type RagReindexAccepted,
  type RagStatus,
  type SearchRequest,
  type SearchResult,
  type SettingRecord,
  type SettingValue,
  type WorldDocument,
  type WorldSummary,
} from "../shared/contracts.js";
import { BookWriterError, IPC_ERROR_CODES } from "../shared/errors.js";
import {
  assertExecutionProvider,
  assertProjectImportInput,
  assertProjectSettingValue,
  assertRequestString,
  assertRunRequest,
  assertRunSubscribeRequest,
  assertRunUnsubscribeRequest,
  assertRagProjectRequest,
  assertRagQueryRequest,
  assertSearchRequest,
  isChapterDocument,
  isChapterSummaryList,
  isProjectDetail,
  isProjectSummary,
  isProviderSummaryList,
  isInstallResult,
  isAuthResult,
  isAuthCancelResult,
  isRecord,
  isRunAccepted,
  isRunCancelResult,
  isRunEventDelivery,
  isRunRecord,
  isRunRecordList,
  isReviewDocument,
  isReviewSummaryList,
  isRunSubscriptionAccepted,
  isRunUnsubscribeResult,
  isHelpDocument,
  isHelpSectionSummaryList,
  isRagQueryResponse,
  isRagReindexAccepted,
  isRagStatus,
  isRagSubscription,
  isRagUnsubscribeResult,
  isSearchResultList,
  isSettingRecord,
  isWorldDocument,
  isWorldSummaryList,
} from "../shared/validation.js";

export interface DesktopRuntime {
  listProviders(): Promise<ProviderSummary[]> | ProviderSummary[];
  getProviderStatus(provider?: ExecutionProvider): Promise<ProviderSummary[]> | ProviderSummary[];
  authenticateProvider(provider: ExecutionProvider): Promise<AuthResult> | AuthResult;
  cancelProviderAuthentication(provider: ExecutionProvider): Promise<AuthCancelResult> | AuthCancelResult;
  listProjects(): Promise<ProjectSummary[]> | ProjectSummary[];
  getProject(projectId: string): Promise<ProjectDetail | null> | ProjectDetail | null;
  openProject(projectId: string): Promise<ProjectSummary> | ProjectSummary;
  importProject(rootPath: string, input: ProjectImportInput): Promise<ProjectDetail> | ProjectDetail;
  listChapters(projectId: string): Promise<ChapterSummary[]> | ChapterSummary[];
  getChapter(projectId: string, chapterId: string): Promise<ChapterDocument> | ChapterDocument;
  listWorld(projectId: string): Promise<WorldSummary[]> | WorldSummary[];
  getWorld(projectId: string, relPath: string): Promise<WorldDocument> | WorldDocument;
  listReviews(projectId: string): Promise<ReviewSummary[]> | ReviewSummary[];
  getReview(projectId: string, relPath: string): Promise<ReviewDocument> | ReviewDocument;
  startRun(request: RunRequest): Promise<RunAccepted> | RunAccepted;
  getRun(runId: string): Promise<RunRecord> | RunRecord;
  listRuns(request?: RunListRequest): Promise<RunRecord[]> | RunRecord[];
  cancelRun(runId: string): Promise<RunCancelResult> | RunCancelResult;
  subscribeRun(
    request: RunSubscribeRequest,
    deliver: (delivery: RunEventDelivery) => void,
  ): Promise<RunSubscriptionAccepted> | RunSubscriptionAccepted;
  unsubscribeRun(subscriptionId: string): Promise<RunUnsubscribeResult> | RunUnsubscribeResult;
  search(request: SearchRequest): Promise<SearchResult[]> | SearchResult[];
  listHelpSections(): HelpSectionSummary[];
  getHelpSection(slug: string): HelpDocument;
  /** Resolve a renderer-supplied project id into a trusted root. Throws if unknown. */
  ragProject(projectId: string, operation: string): { projectId: string; rootPath: string };
  rag: {
    status(projectId: string): RagStatus;
    query(projectId: string, query: string, k?: number): Promise<RagQueryResponse>;
    reindex(project: { projectId: string; rootPath: string }): RagReindexAccepted;
    cancel(projectId: string): RagReindexAccepted;
    subscribe(projectId: string, deliver: (event: RagProgressEvent) => void): string;
    unsubscribe(subscriptionId: string): boolean;
  };
  getSetting(projectId: string, key: string): Promise<SettingRecord | null> | SettingRecord | null;
  setSetting(projectId: string, key: string, value: SettingValue): Promise<SettingRecord> | SettingRecord;
}

export interface RegisterIpcOptions {
  ipcMain: Pick<IpcMain, "handle" | "removeHandler">;
  webContents: WebContents;
  runtime: DesktopRuntime;
  isAllowedFrameUrl(url: string): boolean;
  allowedSettingKeys: ReadonlySet<string>;
  pickProjectRoot?: () => Promise<string | null>;
  installProvider?: (provider: ExecutionProvider, source: InstallSource) => Promise<InstallResult>;
}

type Guard<T> = (value: unknown) => value is T;

const isProjectSummaryList = (value: unknown): value is ProjectSummary[] =>
  Array.isArray(value) && value.every(isProjectSummary);

function success<T>(value: T): IpcResponse<T> {
  return { ok: true, value };
}

function failure(error: unknown, operation: string): IpcResponse<never> {
  if (error instanceof BookWriterError) {
    const serialized = error.toJSON();
    return {
      ok: false,
      error: {
        name: "BookWriterError",
        code: serialized.code,
        message: serialized.message,
        operation: serialized.operation ?? operation,
        ...(serialized.retryable === undefined ? {} : { retryable: serialized.retryable }),
      },
    };
  }
  return {
    ok: false,
    error: {
      name: "BookWriterError",
      code: IPC_ERROR_CODES.invokeFailed,
      message: "The desktop operation failed",
      operation,
      retryable: false,
    },
  };
}

function invalid(message: string, operation: string): never {
  throw new BookWriterError({ code: IPC_ERROR_CODES.invalidArgument, message, operation });
}

function invalidResponse(message: string, operation: string): never {
  throw new BookWriterError({ code: IPC_ERROR_CODES.invalidResponse, message, operation });
}

function assertOnlyKeys(value: unknown, keys: readonly string[], operation: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key))) {
    invalid("request contains unsupported fields", operation);
  }
}

function assertNoRequest(value: unknown, operation: string): void {
  if (value !== undefined) invalid("operation does not accept a request body", operation);
}

function projectIdRequest(value: unknown, operation: string): string {
  assertOnlyKeys(value, ["projectId"], operation);
  assertRequestString(value.projectId, "projectId", operation);
  return value.projectId;
}

function runIdRequest(value: unknown, operation: string): string {
  assertOnlyKeys(value, ["runId"], operation);
  assertRequestString(value.runId, "runId", operation);
  return value.runId;
}

function assertOutput<T>(value: unknown, guard: Guard<T>, operation: string): T {
  if (!guard(value)) {
    throw new BookWriterError({
      code: IPC_ERROR_CODES.invalidResponse,
      message: "The desktop service returned an invalid response",
      operation,
    });
  }
  return value;
}

function assertAuthorized(event: IpcMainInvokeEvent, options: RegisterIpcOptions, operation: string): void {
  const { webContents } = options;
  if (
    webContents.isDestroyed() ||
    event.sender !== webContents ||
    event.senderFrame !== webContents.mainFrame ||
    !options.isAllowedFrameUrl(event.senderFrame.url)
  ) {
    throw new BookWriterError({
      code: IPC_ERROR_CODES.forbidden,
      message: "IPC request did not originate from the application main frame",
      operation,
    });
  }
}

/** Register the complete allow-listed boundary for one renderer main frame. */
export function registerIpcHandlers(options: RegisterIpcOptions): () => void {
  const channels: string[] = [];
  const subscriptions = new Set<string>();
  let active = true;

  const register = <T>(
    channel: string,
    operation: string,
    guard: Guard<T>,
    invoke: (request: unknown, event: IpcMainInvokeEvent) => Promise<T> | T,
  ): void => {
    options.ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        assertAuthorized(event, options, operation);
        if (args.length > 1) invalid("operation accepts at most one request body", operation);
        const request = args[0];
        const value = await invoke(request, event);
        return success(assertOutput(value, guard, operation));
      } catch (error) {
        return failure(error, operation);
      }
    });
    channels.push(channel);
  };

  register(IPC_CHANNELS.providers.list, "providers.list", isProviderSummaryList, (request) => {
    assertNoRequest(request, "providers.list");
    return options.runtime.listProviders();
  });
  register(IPC_CHANNELS.providers.status, "providers.status", isProviderSummaryList, (request) => {
    if (request === undefined) return options.runtime.getProviderStatus();
    assertOnlyKeys(request, ["provider"], "providers.status");
    assertExecutionProvider(request.provider, "providers.status");
    return Promise.resolve(options.runtime.getProviderStatus(request.provider)).then((statuses) => {
      if (statuses.length !== 1 || statuses[0]?.provider !== request.provider) invalidResponse("Provider status did not match the request", "providers.status");
      return statuses;
    });
  });

  const providerInstall = (request: unknown): Promise<InstallResult> => {
    const operation = "providers.install";
    assertOnlyKeys(request, ["provider", "source"], operation);
    assertExecutionProvider(request.provider, operation);
    if (request.source !== "embedded" && request.source !== "executable" && request.source !== "local" && request.source !== "online") {
      invalid("install source is invalid", operation);
    }
    if (!options.installProvider) throw new BookWriterError({ code: IPC_ERROR_CODES.featureUnavailable, message: "Provider installation recovery is unavailable", operation });
    return options.installProvider(request.provider, request.source).then((result) => {
      if (result.provider !== request.provider) invalidResponse("Provider installation did not match the request", operation);
      return result;
    });
  };
  register(IPC_CHANNELS.providers.install, "providers.install", isInstallResult, providerInstall);
  register(IPC_CHANNELS.providers.auth, "providers.auth", isAuthResult, (request) => {
    assertOnlyKeys(request, ["provider"], "providers.auth");
    assertExecutionProvider(request.provider, "providers.auth");
    return Promise.resolve(options.runtime.authenticateProvider(request.provider)).then((result) => {
      if (result.provider !== request.provider) invalidResponse("Provider authentication did not match the request", "providers.auth");
      return result;
    });
  });
  register(IPC_CHANNELS.providers.authCancel, "providers.authCancel", isAuthCancelResult, (request) => {
    assertOnlyKeys(request, ["provider"], "providers.authCancel");
    assertExecutionProvider(request.provider, "providers.authCancel");
    return Promise.resolve(options.runtime.cancelProviderAuthentication(request.provider)).then((result) => {
      if (result.provider !== request.provider) invalidResponse("Provider authentication cancellation did not match the request", "providers.authCancel");
      return result;
    });
  });

  register(IPC_CHANNELS.projects.list, "projects.list", isProjectSummaryList, (request) => {
    assertNoRequest(request, "projects.list");
    return options.runtime.listProjects();
  });
  register(IPC_CHANNELS.projects.get, "projects.get", (value): value is ProjectDetail | null => value === null || isProjectDetail(value), async (request) => {
    const projectId = projectIdRequest(request, "projects.get");
    const project = await options.runtime.getProject(projectId);
    if (project !== null && project.projectId !== projectId) invalidResponse("Project response did not match the request", "projects.get");
    return project;
  });
  register(IPC_CHANNELS.projects.open, "projects.open", isProjectSummary, async (request) => {
    const projectId = projectIdRequest(request, "projects.open");
    const project = await options.runtime.openProject(projectId);
    if (project.projectId !== projectId) invalidResponse("Project response did not match the request", "projects.open");
    return project;
  });
  register(IPC_CHANNELS.projects.import, "projects.import", (value): value is ProjectDetail | null => value === null || isProjectDetail(value), async (request) => {
    assertProjectImportInput(request, "projects.import");
    if (!options.pickProjectRoot) {
      throw new BookWriterError({ code: IPC_ERROR_CODES.featureUnavailable, message: "Project folder selection is unavailable", operation: "projects.import" });
    }
    const rootPath = await options.pickProjectRoot();
    if (rootPath === null) return null;
    return options.runtime.importProject(rootPath, request);
  });

  register(IPC_CHANNELS.content.listChapters, "content.listChapters", isChapterSummaryList, (request) =>
    options.runtime.listChapters(projectIdRequest(request, "content.listChapters")));
  register(IPC_CHANNELS.content.getChapter, "content.getChapter", isChapterDocument, (request) => {
    assertOnlyKeys(request, ["projectId", "chapterId"], "content.getChapter");
    assertRequestString(request.projectId, "projectId", "content.getChapter");
    assertRequestString(request.chapterId, "chapterId", "content.getChapter");
    return options.runtime.getChapter(request.projectId, request.chapterId);
  });
  register(IPC_CHANNELS.content.listWorld, "content.listWorld", isWorldSummaryList, (request) =>
    options.runtime.listWorld(projectIdRequest(request, "content.listWorld")));
  register(IPC_CHANNELS.content.getWorld, "content.getWorld", isWorldDocument, (request) => {
    assertOnlyKeys(request, ["projectId", "relPath"], "content.getWorld");
    assertRequestString(request.projectId, "projectId", "content.getWorld");
    assertRequestString(request.relPath, "relPath", "content.getWorld");
    return options.runtime.getWorld(request.projectId, request.relPath);
  });
  register(IPC_CHANNELS.content.listReviews, "content.listReviews", isReviewSummaryList, (request) => options.runtime.listReviews(projectIdRequest(request, "content.listReviews")));
  register(IPC_CHANNELS.content.getReview, "content.getReview", isReviewDocument, (request) => {
    assertOnlyKeys(request, ["projectId", "relPath"], "content.getReview");
    assertRequestString(request.projectId, "projectId", "content.getReview");
    assertRequestString(request.relPath, "relPath", "content.getReview");
    return options.runtime.getReview(request.projectId, request.relPath);
  });

  register(IPC_CHANNELS.runs.start, "runs.start", isRunAccepted, (request) => {
    assertRunRequest(request, "runs.start");
    return options.runtime.startRun(request);
  });
  register(IPC_CHANNELS.runs.list, "runs.list", isRunRecordList, (request) => {
    if (request === undefined) return options.runtime.listRuns();
    assertOnlyKeys(request, ["projectId", "skillId", "limit"], "runs.list");
    if (request.projectId !== undefined) assertRequestString(request.projectId, "projectId", "runs.list");
    if (request.skillId !== undefined) assertRequestString(request.skillId, "skillId", "runs.list");
    if (request.limit !== undefined && (!Number.isSafeInteger(request.limit) || (request.limit as number) < 1 || (request.limit as number) > 100)) invalid("limit must be an integer from 1 to 100", "runs.list");
    return options.runtime.listRuns(request as RunListRequest);
  });
  register(IPC_CHANNELS.runs.get, "runs.get", isRunRecord, (request) =>
    options.runtime.getRun(runIdRequest(request, "runs.get")));
  register(IPC_CHANNELS.runs.cancel, "runs.cancel", isRunCancelResult, async (request) => {
    const runId = runIdRequest(request, "runs.cancel");
    const result = await options.runtime.cancelRun(runId);
    if (result.runId !== runId) invalidResponse("Run response did not match the request", "runs.cancel");
    return result;
  });
  register(IPC_CHANNELS.runs.subscribe, "runs.subscribe", isRunSubscriptionAccepted, async (request) => {
    assertRunSubscribeRequest(request, "runs.subscribe");
    let acceptedId: string | undefined;
    let provisionalId: string | undefined;
    const cleanup = (subscriptionId: string | undefined): void => {
      if (!subscriptionId) return;
      void Promise.resolve(options.runtime.unsubscribeRun(subscriptionId)).catch(() => undefined);
    };
    try {
      const rawAccepted = await options.runtime.subscribeRun(request, (delivery) => {
        if (!active || options.webContents.isDestroyed() || !isRunEventDelivery(delivery)) return;
        if (delivery.event.runId !== request.runId) return;
        provisionalId ??= delivery.subscriptionId;
        if (delivery.subscriptionId !== provisionalId) return;
        if (acceptedId !== undefined && (!subscriptions.has(acceptedId) || delivery.subscriptionId !== acceptedId)) return;
        try {
          options.webContents.send(IPC_CHANNELS.runs.event, success(delivery));
        } catch {
          // The window can be destroyed between the check and send. Its close
          // disposer owns subscription cancellation.
        }
      });
      if (isRecord(rawAccepted) && typeof rawAccepted.subscriptionId === "string" && rawAccepted.subscriptionId.trim()) {
        acceptedId = rawAccepted.subscriptionId;
      }
      const accepted = assertOutput(rawAccepted, isRunSubscriptionAccepted, "runs.subscribe");
      acceptedId = accepted.subscriptionId;
      if (
        !active ||
        accepted.runId !== request.runId ||
        (provisionalId !== undefined && provisionalId !== accepted.subscriptionId)
      ) {
        throw new BookWriterError({
          code: active ? IPC_ERROR_CODES.invalidResponse : IPC_ERROR_CODES.forbidden,
          message: active ? "Run subscription did not match the request" : "Renderer closed during subscription",
          operation: "runs.subscribe",
        });
      }
      subscriptions.add(accepted.subscriptionId);
      return accepted;
    } catch (error) {
      cleanup(provisionalId);
      if (acceptedId !== provisionalId) cleanup(acceptedId);
      throw error;
    }
  });
  register(IPC_CHANNELS.runs.unsubscribe, "runs.unsubscribe", isRunUnsubscribeResult, async (request) => {
    assertRunUnsubscribeRequest(request, "runs.unsubscribe");
    if (!subscriptions.has(request.subscriptionId)) {
      return { subscriptionId: request.subscriptionId, unsubscribed: false };
    }
    const result = await options.runtime.unsubscribeRun(request.subscriptionId);
    if (result.subscriptionId !== request.subscriptionId) {
      throw new BookWriterError({ code: IPC_ERROR_CODES.invalidResponse, message: "Unsubscribe response did not match the request", operation: "runs.unsubscribe" });
    }
    subscriptions.delete(request.subscriptionId);
    return result;
  });

  register(IPC_CHANNELS.help.list, "help.list", isHelpSectionSummaryList, (request) => {
    assertNoRequest(request, "help.list");
    return options.runtime.listHelpSections();
  });
  register(IPC_CHANNELS.help.get, "help.get", isHelpDocument, (request) => {
    assertOnlyKeys(request, ["slug"], "help.get");
    assertRequestString(request.slug, "slug", "help.get");
    const document = options.runtime.getHelpSection(request.slug);
    if (document.slug !== request.slug) invalidResponse("Guide response did not match the request", "help.get");
    return document;
  });

  register(IPC_CHANNELS.rag.status, "rag.status", isRagStatus, (request) => {
    assertRagProjectRequest(request, "rag.status");
    options.runtime.ragProject(request.projectId, "rag.status");
    return options.runtime.rag.status(request.projectId);
  });
  register(IPC_CHANNELS.rag.query, "rag.query", isRagQueryResponse, async (request) => {
    assertRagQueryRequest(request, "rag.query");
    options.runtime.ragProject(request.projectId, "rag.query");
    const response = await options.runtime.rag.query(request.projectId, request.query, request.k);
    if (response.projectId !== request.projectId) {
      invalidResponse("Rag response did not match the request", "rag.query");
    }
    return response;
  });
  register(IPC_CHANNELS.rag.reindex, "rag.reindex", isRagReindexAccepted, (request) => {
    assertRagProjectRequest(request, "rag.reindex");
    // The trusted record is resolved here, never sent by the renderer, so
    // indexing can only ever walk a registered project's own root.
    const project = options.runtime.ragProject(request.projectId, "rag.reindex");
    return options.runtime.rag.reindex(project);
  });
  register(IPC_CHANNELS.rag.cancel, "rag.cancel", isRagReindexAccepted, (request) => {
    assertRagProjectRequest(request, "rag.cancel");
    options.runtime.ragProject(request.projectId, "rag.cancel");
    return options.runtime.rag.cancel(request.projectId);
  });
  register(IPC_CHANNELS.rag.subscribe, "rag.subscribe", isRagSubscription, (request) => {
    assertRagProjectRequest(request, "rag.subscribe");
    options.runtime.ragProject(request.projectId, "rag.subscribe");
    const subscriptionId = options.runtime.rag.subscribe(request.projectId, (event) => {
      if (!active || options.webContents.isDestroyed()) return;
      if (event.projectId !== request.projectId) return;
      try {
        options.webContents.send(IPC_CHANNELS.rag.event, success({ subscriptionId, event }));
      } catch {
        // The window can be destroyed between the check and the send; its
        // close disposer owns releasing the subscription.
      }
    });
    subscriptions.add(subscriptionId);
    return { subscriptionId };
  });
  register(IPC_CHANNELS.rag.unsubscribe, "rag.unsubscribe", isRagUnsubscribeResult, (request) => {
    assertOnlyKeys(request, ["subscriptionId"], "rag.unsubscribe");
    assertRequestString(request.subscriptionId, "subscriptionId", "rag.unsubscribe");
    if (!subscriptions.has(request.subscriptionId)) {
      return { subscriptionId: request.subscriptionId, released: false };
    }
    const released = options.runtime.rag.unsubscribe(request.subscriptionId);
    subscriptions.delete(request.subscriptionId);
    return { subscriptionId: request.subscriptionId, released };
  });

  register(IPC_CHANNELS.search.query, "search.query", isSearchResultList, (request) => {
    assertSearchRequest(request, "search.query");
    return options.runtime.search(request);
  });
  register(IPC_CHANNELS.settings.get, "settings.get", (value): value is SettingRecord | null => value === null || isSettingRecord(value), async (request) => {
    assertOnlyKeys(request, ["projectId", "key"], "settings.get");
    assertRequestString(request.projectId, "projectId", "settings.get");
    assertRequestString(request.key, "key", "settings.get");
    if (!options.allowedSettingKeys.has(request.key)) invalid("setting key is not allowed", "settings.get");
    const setting = await options.runtime.getSetting(request.projectId, request.key);
    if (setting !== null && (setting.projectId !== request.projectId || setting.key !== request.key)) {
      invalidResponse("Setting response did not match the request", "settings.get");
    }
    return setting;
  });
  register(IPC_CHANNELS.settings.set, "settings.set", isSettingRecord, (request) => {
    assertOnlyKeys(request, ["projectId", "key", "value"], "settings.set");
    assertRequestString(request.projectId, "projectId", "settings.set");
    assertRequestString(request.key, "key", "settings.set");
    if (!options.allowedSettingKeys.has(request.key)) invalid("setting key is not allowed", "settings.set");
    assertProjectSettingValue(request.key, request.value, "settings.set");
    return Promise.resolve(options.runtime.setSetting(request.projectId, request.key, request.value)).then((setting) => {
      if (setting.projectId !== request.projectId || setting.key !== request.key) {
        throw new BookWriterError({ code: IPC_ERROR_CODES.invalidResponse, message: "Setting response did not match the request", operation: "settings.set" });
      }
      return setting;
    });
  });

  return () => {
    if (!active) return;
    active = false;
    for (const channel of channels) options.ipcMain.removeHandler(channel);
    for (const subscriptionId of subscriptions) {
      void Promise.resolve(options.runtime.unsubscribeRun(subscriptionId)).catch(() => undefined);
    }
    subscriptions.clear();
  };
}
