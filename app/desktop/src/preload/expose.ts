import { asBookWriterError, BookWriterError } from "../shared/errors.js";
import {
  BOOK_WRITER_WINDOW_KEY,
  IPC_CHANNELS,
  type AuthResult,
  type AuthCancelResult,
  type BookWriterApi,
  type ChapterDocument,
  type ChapterSummary,
  type ContentApi,
  type ExecutionProvider,
  type InstallResult,
  type ProjectApi,
  type ProjectDetail,
  type ProjectSummary,
  type ProviderApi,
  type RunAccepted,
  type RunApi,
  type RunCancelResult,
  type RunEvent,
  type RunEventDelivery,
  type RunEventListener,
  type RunRecord,
  type RunListRequest,
  type ReviewDocument,
  type ReviewSummary,
  type RunRequest,
  RUN_REPLAY_LIMIT,
  type RunSubscription,
  type RunSubscriptionAccepted,
  type RunSubscriptionOptions,
  type RunUnsubscribeResult,
  type SearchApi,
  type SearchRequest,
  type SearchResult,
  type SettingRecord,
  type SettingValue,
  type SettingsApi,
  type StructuredError,
  type WorldDocument,
  type WorldSummary,
} from "../shared/contracts.js";
import {
  assertExecutionProvider,
  assertProjectImportInput,
  assertRequestString,
  assertRunRequest,
  assertRunSubscriptionOptions,
  assertSearchRequest,
  assertSettingValue,
  isAuthResult,
  isAuthCancelResult,
  isChapterDocument,
  isChapterSummaryList,
  isInstallResult,
  isProjectDetail,
  isProjectSummary,
  isProviderSummaryList,
  isRunAccepted,
  isRunCancelResult,
  isRunEventDelivery,
  isRunRecord,
  isRunRecordList,
  isReviewDocument,
  isReviewSummaryList,
  isRunSubscriptionAccepted,
  isRunUnsubscribeResult,
  isSearchResultList,
  isSettingRecord,
  isWorldDocument,
  isWorldSummaryList,
  parseResponse,
} from "../shared/validation.js";

export interface ContextBridgeLike {
  exposeInMainWorld(key: string, api: unknown): void;
}

export interface IpcRendererLike {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): this;
  removeListener(channel: string, listener: (...args: unknown[]) => void): this;
}

function call<T>(
  ipcRenderer: IpcRendererLike,
  channel: string,
  operation: string,
  guard: (value: unknown) => value is T,
  request?: unknown,
): Promise<T> {
  const invocation = request === undefined ? ipcRenderer.invoke(channel) : ipcRenderer.invoke(channel, request);
  return invocation
    .then((value) => parseResponse(value, guard, operation))
    .catch((error) => {
      throw asBookWriterError(error, operation);
    });
}

function createProvidersApi(ipcRenderer: IpcRendererLike): ProviderApi {
  return {
    list: () => call(ipcRenderer, IPC_CHANNELS.providers.list, "providers.list", isProviderSummaryList),
    status: (provider?: ExecutionProvider) => {
      if (provider !== undefined) assertExecutionProvider(provider, "providers.status");
      return call(ipcRenderer, IPC_CHANNELS.providers.status, "providers.status", isProviderSummaryList, provider ? { provider } : undefined);
    },
    install: (provider) => {
      assertExecutionProvider(provider, "providers.install");
      return call<InstallResult>(ipcRenderer, IPC_CHANNELS.providers.install, "providers.install", isInstallResult, { provider });
    },
    auth: (provider) => {
      assertExecutionProvider(provider, "providers.auth");
      return call<AuthResult>(ipcRenderer, IPC_CHANNELS.providers.auth, "providers.auth", isAuthResult, { provider });
    },
    cancelAuth: (provider) => {
      assertExecutionProvider(provider, "providers.authCancel");
      return call<AuthCancelResult>(ipcRenderer, IPC_CHANNELS.providers.authCancel, "providers.authCancel", isAuthCancelResult, { provider });
    },
  };
}

function createProjectsApi(ipcRenderer: IpcRendererLike): ProjectApi {
  return {
    list: () => call(ipcRenderer, IPC_CHANNELS.projects.list, "projects.list", (value): value is ProjectSummary[] => Array.isArray(value) && value.every(isProjectSummary)),
    get: (projectId) => {
      assertRequestString(projectId, "projectId", "projects.get");
      return call<ProjectDetail | null>(ipcRenderer, IPC_CHANNELS.projects.get, "projects.get", (value): value is ProjectDetail | null => value === null || isProjectDetail(value), { projectId });
    },
    open: (projectId) => {
      assertRequestString(projectId, "projectId", "projects.open");
      return call(ipcRenderer, IPC_CHANNELS.projects.open, "projects.open", isProjectSummary, { projectId });
    },
    import: (input) => {
      assertProjectImportInput(input, "projects.import");
      return call<ProjectDetail | null>(ipcRenderer, IPC_CHANNELS.projects.import, "projects.import", (value): value is ProjectDetail | null => value === null || isProjectDetail(value), input);
    },
  };
}

function createContentApi(ipcRenderer: IpcRendererLike): ContentApi {
  return {
    listChapters: (projectId) => {
      assertRequestString(projectId, "projectId", "content.listChapters");
      return call<ChapterSummary[]>(ipcRenderer, IPC_CHANNELS.content.listChapters, "content.listChapters", isChapterSummaryList, { projectId });
    },
    getChapter: (projectId, chapterId) => {
      assertRequestString(projectId, "projectId", "content.getChapter");
      assertRequestString(chapterId, "chapterId", "content.getChapter");
      return call<ChapterDocument>(ipcRenderer, IPC_CHANNELS.content.getChapter, "content.getChapter", isChapterDocument, { projectId, chapterId });
    },
    listWorld: (projectId) => {
      assertRequestString(projectId, "projectId", "content.listWorld");
      return call<WorldSummary[]>(ipcRenderer, IPC_CHANNELS.content.listWorld, "content.listWorld", isWorldSummaryList, { projectId });
    },
      getWorld: (projectId, relPath) => {
      assertRequestString(projectId, "projectId", "content.getWorld");
      assertRequestString(relPath, "relPath", "content.getWorld");
      return call<WorldDocument>(ipcRenderer, IPC_CHANNELS.content.getWorld, "content.getWorld", isWorldDocument, { projectId, relPath });
      },
      listReviews: (projectId) => {
        assertRequestString(projectId, "projectId", "content.listReviews");
        return call<ReviewSummary[]>(ipcRenderer, IPC_CHANNELS.content.listReviews, "content.listReviews", isReviewSummaryList, { projectId });
      },
      getReview: (projectId, relPath) => {
        assertRequestString(projectId, "projectId", "content.getReview");
        assertRequestString(relPath, "relPath", "content.getReview");
        return call<ReviewDocument>(ipcRenderer, IPC_CHANNELS.content.getReview, "content.getReview", isReviewDocument, { projectId, relPath });
      },
  };
}

function createRunsApi(ipcRenderer: IpcRendererLike): RunApi {
  const subscriptions = new Map<string, (...args: unknown[]) => void>();

  return {
    start: (request: RunRequest) => {
      assertRunRequest(request, "runs.start");
      return call<RunAccepted>(ipcRenderer, IPC_CHANNELS.runs.start, "runs.start", isRunAccepted, request);
    },
    list: (request?: RunListRequest) => {
      if (request !== undefined && (typeof request !== "object" || request === null)) throw new BookWriterError({ code: "INVALID_ARGUMENT", message: "run list request must be an object", operation: "runs.list" });
      return call<RunRecord[]>(ipcRenderer, IPC_CHANNELS.runs.list, "runs.list", isRunRecordList, request);
    },
    get: (runId) => {
      assertRequestString(runId, "runId", "runs.get");
      return call<RunRecord>(ipcRenderer, IPC_CHANNELS.runs.get, "runs.get", isRunRecord, { runId });
    },
    cancel: (runId) => {
      assertRequestString(runId, "runId", "runs.cancel");
      return call<RunCancelResult>(ipcRenderer, IPC_CHANNELS.runs.cancel, "runs.cancel", isRunCancelResult, { runId });
    },
    subscribe: async (runId: string, listener: RunEventListener, options?: RunSubscriptionOptions, onError?: (error: StructuredError) => void): Promise<RunSubscription> => {
      assertRequestString(runId, "runId", "runs.subscribe");
      assertRunSubscriptionOptions(options, "runs.subscribe");
      if (typeof listener !== "function") throw new BookWriterError({ code: "INVALID_ARGUMENT", message: "listener must be a function", operation: "runs.subscribe" });
      if (onError !== undefined && typeof onError !== "function") throw new BookWriterError({ code: "INVALID_ARGUMENT", message: "onError must be a function", operation: "runs.subscribe" });
      const afterSequence = options?.afterSequence ?? -1;
      let accepted: RunSubscriptionAccepted | undefined;
      let active = true;
      let lastSequence = afterSequence;
      let pendingOverflow = false;
      const pending: RunEventDelivery[] = [];
      const reportError = (error: unknown) => onError?.(asBookWriterError(error, "runs.subscribe").toJSON());
      const deliver = (event: RunEvent) => {
        if (!active || event.sequence <= lastSequence) return;
        if (event.runId !== runId) {
          reportError(new BookWriterError({ code: "INVALID_RESPONSE", message: "run event does not match subscription", operation: "runs.subscribe" }));
          return;
        }
        lastSequence = event.sequence;
        try {
          listener(event);
        } catch (error) {
          reportError(error);
        }
      };
      const wrapped = (...args: unknown[]) => {
        const payload = args.length > 1 ? args[1] : args[0];
        try {
          const delivery = parseResponse(payload, isRunEventDelivery, "runs.subscribe");
          if (accepted) {
            if (delivery.subscriptionId === accepted.subscriptionId) deliver(delivery.event);
          } else if (delivery.event.runId !== runId) {
            return;
          } else if (pending.length < RUN_REPLAY_LIMIT) {
            pending.push(delivery);
          } else {
            pendingOverflow = true;
          }
        } catch (error) {
          reportError(error);
        }
      };
      ipcRenderer.on(IPC_CHANNELS.runs.event, wrapped);
      try {
        const request = options?.afterSequence === undefined ? { runId } : { runId, afterSequence: options.afterSequence };
        accepted = await call<RunSubscriptionAccepted>(ipcRenderer, IPC_CHANNELS.runs.subscribe, "runs.subscribe", isRunSubscriptionAccepted, request);
        if (accepted.runId !== runId || accepted.replayCursor < afterSequence) {
          throw new BookWriterError({ code: "INVALID_RESPONSE", message: "subscription response does not match request", operation: "runs.subscribe" });
        }
        if (subscriptions.has(accepted.subscriptionId)) {
          throw new BookWriterError({ code: "INVALID_RESPONSE", message: "subscription id is already active", operation: "runs.subscribe" });
        }
        if (pendingOverflow) {
          throw new BookWriterError({ code: "INVALID_RESPONSE", message: "run event buffer exceeded its safety limit during subscription", operation: "runs.subscribe" });
        }
        const buffered = pending.filter((delivery) => delivery.subscriptionId === accepted!.subscriptionId).map((delivery) => delivery.event);
        const initialEvents = [...accepted.replay, ...buffered].sort((left, right) => left.sequence - right.sequence);
        if (!accepted.replayTruncated) {
          let expectedSequence = afterSequence + 1;
          for (const event of initialEvents) {
            if (event.sequence < expectedSequence) continue;
            if (event.sequence > accepted.replayCursor) break;
            if (event.sequence !== expectedSequence) {
              throw new BookWriterError({ code: "INVALID_RESPONSE", message: "subscription replay contains a sequence gap", operation: "runs.subscribe" });
            }
            expectedSequence += 1;
          }
          if (expectedSequence <= accepted.replayCursor) {
            throw new BookWriterError({ code: "INVALID_RESPONSE", message: "subscription replay ended before its cursor", operation: "runs.subscribe" });
          }
        }
        for (const event of initialEvents) deliver(event);
        subscriptions.set(accepted.subscriptionId, wrapped);
        return {
          subscriptionId: accepted.subscriptionId,
          runId: accepted.runId,
          replayCursor: accepted.replayCursor,
          replayTruncated: accepted.replayTruncated,
        };
      } catch (error) {
        active = false;
        ipcRenderer.removeListener(IPC_CHANNELS.runs.event, wrapped);
        if (accepted) {
          void call(ipcRenderer, IPC_CHANNELS.runs.unsubscribe, "runs.unsubscribe", isRunUnsubscribeResult, { subscriptionId: accepted.subscriptionId }).catch(() => undefined);
        }
        throw asBookWriterError(error, "runs.subscribe");
      }
    },
    unsubscribe: async (subscriptionId: string): Promise<RunUnsubscribeResult> => {
      assertRequestString(subscriptionId, "subscriptionId", "runs.unsubscribe");
      const wrapped = subscriptions.get(subscriptionId);
      if (wrapped) {
        subscriptions.delete(subscriptionId);
        ipcRenderer.removeListener(IPC_CHANNELS.runs.event, wrapped);
      }
      return call<RunUnsubscribeResult>(
        ipcRenderer,
        IPC_CHANNELS.runs.unsubscribe,
        "runs.unsubscribe",
        (value): value is RunUnsubscribeResult => isRunUnsubscribeResult(value) && value.subscriptionId === subscriptionId,
        { subscriptionId },
      );
    },
  };
}

function createSearchApi(ipcRenderer: IpcRendererLike): SearchApi {
  return {
    query: (request: SearchRequest) => {
      assertSearchRequest(request, "search.query");
      return call<SearchResult[]>(ipcRenderer, IPC_CHANNELS.search.query, "search.query", isSearchResultList, request);
    },
  };
}

function createSettingsApi(ipcRenderer: IpcRendererLike): SettingsApi {
  return {
    get: (projectId, key) => {
      assertRequestString(projectId, "projectId", "settings.get");
      assertRequestString(key, "key", "settings.get");
      return call<SettingRecord | null>(ipcRenderer, IPC_CHANNELS.settings.get, "settings.get", (value): value is SettingRecord | null => value === null || isSettingRecord(value), { projectId, key });
    },
    set: (projectId, key, value: SettingValue) => {
      assertRequestString(projectId, "projectId", "settings.set");
      assertRequestString(key, "key", "settings.set");
      assertSettingValue(value, "settings.set");
      return call<SettingRecord>(ipcRenderer, IPC_CHANNELS.settings.set, "settings.set", isSettingRecord, { projectId, key, value });
    },
  };
}

export function createBookWriterApi(ipcRenderer: IpcRendererLike): BookWriterApi {
  return {
    providers: createProvidersApi(ipcRenderer),
    projects: createProjectsApi(ipcRenderer),
    content: createContentApi(ipcRenderer),
    runs: createRunsApi(ipcRenderer),
    search: createSearchApi(ipcRenderer),
    settings: createSettingsApi(ipcRenderer),
  };
}

export function exposeBookWriter(contextBridge: ContextBridgeLike, ipcRenderer: IpcRendererLike): BookWriterApi {
  const api = createBookWriterApi(ipcRenderer);
  contextBridge.exposeInMainWorld(BOOK_WRITER_WINDOW_KEY, api);
  return api;
}
