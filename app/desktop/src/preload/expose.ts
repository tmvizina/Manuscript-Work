import { asBookWriterError, BookWriterError } from "../shared/errors.js";
import {
  BOOK_WRITER_WINDOW_KEY,
  IPC_CHANNELS,
  type AuthResult,
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
  type RunEventListener,
  type RunRecord,
  type RunRequest,
  type SearchApi,
  type SearchRequest,
  type SearchResult,
  type SettingRecord,
  type SettingValue,
  type SettingsApi,
  type StructuredError,
  type Unsubscribe,
  type WorldDocument,
} from "../shared/contracts.js";
import {
  assertExecutionProvider,
  assertRequestString,
  assertRunRequest,
  assertSearchRequest,
  assertSettingValue,
  isAuthResult,
  isChapterDocument,
  isChapterSummaryList,
  isInstallResult,
  isProjectDetail,
  isProjectSummary,
  isProviderSummaryList,
  isRunAccepted,
  isRunCancelResult,
  isRunEvent,
  isRunRecord,
  isSearchResultList,
  isSettingRecord,
  isWorldDocument,
  isWorldDocumentList,
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
      return call<WorldDocument[]>(ipcRenderer, IPC_CHANNELS.content.listWorld, "content.listWorld", isWorldDocumentList, { projectId });
    },
    getWorld: (projectId, relPath) => {
      assertRequestString(projectId, "projectId", "content.getWorld");
      assertRequestString(relPath, "relPath", "content.getWorld");
      return call<WorldDocument>(ipcRenderer, IPC_CHANNELS.content.getWorld, "content.getWorld", isWorldDocument, { projectId, relPath });
    },
  };
}

function createRunsApi(ipcRenderer: IpcRendererLike): RunApi {
  return {
    start: (request: RunRequest) => {
      assertRunRequest(request, "runs.start");
      return call<RunAccepted>(ipcRenderer, IPC_CHANNELS.runs.start, "runs.start", isRunAccepted, request);
    },
    get: (runId) => {
      assertRequestString(runId, "runId", "runs.get");
      return call<RunRecord>(ipcRenderer, IPC_CHANNELS.runs.get, "runs.get", isRunRecord, { runId });
    },
    cancel: (runId) => {
      assertRequestString(runId, "runId", "runs.cancel");
      return call<RunCancelResult>(ipcRenderer, IPC_CHANNELS.runs.cancel, "runs.cancel", isRunCancelResult, { runId });
    },
    subscribe: (runId: string, listener: RunEventListener, onError?: (error: StructuredError) => void): Unsubscribe => {
      assertRequestString(runId, "runId", "runs.subscribe");
      if (typeof listener !== "function") throw new BookWriterError({ code: "INVALID_ARGUMENT", message: "listener must be a function", operation: "runs.subscribe" });
      if (onError !== undefined && typeof onError !== "function") throw new BookWriterError({ code: "INVALID_ARGUMENT", message: "onError must be a function", operation: "runs.subscribe" });
      const wrapped = (...args: unknown[]) => {
        const payload = args.length > 1 ? args[1] : args[0];
        try {
          const event = parseResponse(payload, isRunEvent, "runs.subscribe");
          if (event.runId === runId) listener(event);
        } catch (error) {
          onError?.(asBookWriterError(error, "runs.subscribe").toJSON());
        }
      };
      ipcRenderer.on(IPC_CHANNELS.runs.event, wrapped);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.runs.event, wrapped);
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
