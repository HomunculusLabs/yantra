import { create } from "zustand";
import type {
  FrontMatter,
  PageData,
  PageLoadState,
  SaveStatus,
} from "@/types";
import { fetchPage, savePage } from "@/lib/api/client";
import { markdownToHtml } from "@/lib/markdown/to-html";

type PageSource = "tree-click" | "tree-keyboard" | "search" | "mutation";
type PageKind = PageData["kind"] | null;

interface LoadPageOptions {
  source?: PageSource;
  kindHint?: "markdown" | "directory-index" | "text";
  force?: boolean;
}

interface CachedPageEntry {
  page: PageData;
  preparedHtml?: string;
  preparedForPath: string;
  dirty: boolean;
  lastAccessedAt: number;
  revision: number;
}

interface PageSnapshot {
  path: string;
  content: string;
  frontmatter: FrontMatter;
  revision: number;
}

interface EditorState {
  currentPath: string | null;
  content: string;
  frontmatter: FrontMatter | null;
  pageKind: PageKind;
  saveStatus: SaveStatus;
  isDirty: boolean;
  pageLoadState: PageLoadState;
  preparedHtml: string | null;
  preparedHtmlVersion: number;
  activeRevision: number;

  loadPage: (path: string, options?: LoadPageOptions) => Promise<void>;
  prefetchPage: (path: string) => Promise<void>;
  prefetchPages: (paths: string[]) => Promise<void>;
  updateContent: (content: string) => void;
  updateFrontmatter: (updates: Partial<FrontMatter>) => void;
  save: () => Promise<void>;
  retryCurrentPage: () => Promise<void>;
  rebasePath: (fromPath: string, toPath: string) => void;
  invalidatePath: (path: string) => void;
  flushPendingSavesForPrefix: (path: string) => Promise<void>;
  clear: () => void;
}

const MAX_PAGE_CACHE_ENTRIES = 40;
const MAX_PREPARED_HTML_ENTRIES = 10;
const SAVE_DEBOUNCE_MS = 500;

const pageCache = new Map<string, CachedPageEntry>();
const inflightLoads = new Map<string, Promise<PageData>>();
const inflightPrepares = new Map<string, Promise<string>>();
const saveTimersByPath = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSavesByPath = new Map<string, Promise<void>>();
let statusTimer: ReturnType<typeof setTimeout> | null = null;
let openRequestSeq = 0;
let preparedHtmlVersionSeq = 0;

function isMarkdownKind(kind: PageData["kind"] | undefined | null) {
  return kind === "markdown" || kind === "directory-index";
}

function matchesPathPrefix(candidate: string | null | undefined, path: string) {
  if (!candidate) return false;
  return candidate === path || candidate.startsWith(`${path}/`);
}

function scheduleIdle(callback: () => void) {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    (window as Window & {
      requestIdleCallback: (cb: () => void) => number;
    }).requestIdleCallback(callback);
    return;
  }
  setTimeout(callback, 0);
}

export const useEditorStore = create<EditorState>((set, get) => {
  const touchCacheEntry = (path: string, entry: CachedPageEntry) => {
    entry.lastAccessedAt = Date.now();
    pageCache.delete(path);
    pageCache.set(path, entry);
  };

  const trimCache = () => {
    const activePath = get().currentPath;

    let preparedEntries = Array.from(pageCache.entries()).filter(([, entry]) => entry.preparedHtml);
    for (const [path, entry] of preparedEntries) {
      if (preparedEntries.length <= MAX_PREPARED_HTML_ENTRIES) break;
      if (path === activePath || entry.dirty || !entry.preparedHtml) continue;
      delete entry.preparedHtml;
      touchCacheEntry(path, entry);
      preparedEntries = Array.from(pageCache.entries()).filter(([, current]) => current.preparedHtml);
    }

    while (pageCache.size > MAX_PAGE_CACHE_ENTRIES) {
      const removable = Array.from(pageCache.entries()).find(
        ([path, entry]) => path !== activePath && !entry.dirty
      );
      if (!removable) break;
      pageCache.delete(removable[0]);
    }
  };

  const upsertCacheEntry = (
    path: string,
    page: PageData,
    overrides: Partial<CachedPageEntry> = {}
  ) => {
    const existing = pageCache.get(path);
    const entry: CachedPageEntry = {
      page,
      preparedForPath: path,
      dirty: existing?.dirty ?? false,
      lastAccessedAt: Date.now(),
      revision: existing?.revision ?? 0,
      preparedHtml: existing?.preparedHtml,
      ...overrides,
    };
    touchCacheEntry(path, entry);
    trimCache();
    return entry;
  };

  const getSnapshotForPath = (path: string): PageSnapshot | null => {
    const state = get();
    if (state.currentPath === path && state.frontmatter) {
      return {
        path,
        content: state.content,
        frontmatter: state.frontmatter,
        revision: state.activeRevision,
      };
    }

    const cached = pageCache.get(path);
    if (!cached) return null;

    return {
      path,
      content: cached.page.content,
      frontmatter: cached.page.frontmatter,
      revision: cached.revision,
    };
  };

  const markSavedIfCurrent = (path: string, revision: number) => {
    const state = get();
    if (state.currentPath !== path || state.activeRevision !== revision) return;

    set({ saveStatus: "saved", isDirty: false });
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      const latest = get();
      if (latest.currentPath === path && latest.activeRevision === revision) {
        set({ saveStatus: "idle" });
      }
    }, 2000);
  };

  const flushSnapshot = async (
    snapshot: PageSnapshot,
    options?: { reportForCurrent?: boolean }
  ) => {
    const previous = pendingSavesByPath.get(snapshot.path) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const currentState = get();
        if (
          options?.reportForCurrent &&
          currentState.currentPath === snapshot.path &&
          currentState.activeRevision === snapshot.revision
        ) {
          set({ saveStatus: "saving" });
        }

        await savePage(snapshot.path, snapshot.content, snapshot.frontmatter);

        const cached = pageCache.get(snapshot.path);
        if (cached && cached.revision === snapshot.revision) {
          cached.dirty = false;
          cached.page = {
            ...cached.page,
            content: snapshot.content,
            frontmatter: snapshot.frontmatter,
          };
          touchCacheEntry(snapshot.path, cached);
        }

        markSavedIfCurrent(snapshot.path, snapshot.revision);
      })
      .catch((error) => {
        const currentState = get();
        if (
          currentState.currentPath === snapshot.path &&
          currentState.activeRevision === snapshot.revision
        ) {
          set({ saveStatus: "error" });
        }
        throw error;
      })
      .finally(() => {
        if (pendingSavesByPath.get(snapshot.path) === next) {
          pendingSavesByPath.delete(snapshot.path);
        }
      });

    pendingSavesByPath.set(snapshot.path, next);
    await next;
  };

  const scheduleSave = (path: string) => {
    const existingTimer = saveTimersByPath.get(path);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      saveTimersByPath.delete(path);
      const snapshot = getSnapshotForPath(path);
      if (!snapshot) return;
      void flushSnapshot(snapshot);
    }, SAVE_DEBOUNCE_MS);
    saveTimersByPath.set(path, timer);
  };

  const prepareHtmlForPath = async (path: string, entry: CachedPageEntry) => {
    if (!isMarkdownKind(entry.page.kind)) {
      return "";
    }

    if (entry.preparedHtml) {
      touchCacheEntry(path, entry);
      return entry.preparedHtml;
    }

    const existingPromise = inflightPrepares.get(path);
    if (existingPromise) {
      return existingPromise;
    }

    const revision = entry.revision;
    const promise = markdownToHtml(entry.page.content, path)
      .then((html) => {
        const latest = pageCache.get(path);
        if (latest && latest.revision === revision) {
          latest.preparedHtml = html;
          latest.preparedForPath = path;
          touchCacheEntry(path, latest);
          trimCache();
        }
        return html;
      })
      .finally(() => {
        if (inflightPrepares.get(path) === promise) {
          inflightPrepares.delete(path);
        }
      });

    inflightPrepares.set(path, promise);
    return promise;
  };

  const queuePrepareIfNeeded = (path: string) => {
    const entry = pageCache.get(path);
    if (!entry || !isMarkdownKind(entry.page.kind) || entry.preparedHtml) return;
    scheduleIdle(() => {
      const latest = pageCache.get(path);
      if (!latest || latest.preparedHtml || !isMarkdownKind(latest.page.kind)) return;
      void prepareHtmlForPath(path, latest).catch(() => undefined);
    });
  };

  const fetchAndCachePage = async (
    path: string,
    options?: { force?: boolean }
  ): Promise<PageData> => {
    if (!options?.force) {
      const cached = pageCache.get(path);
      if (cached) {
        touchCacheEntry(path, cached);
        return cached.page;
      }
    }

    const inflight = inflightLoads.get(path);
    if (inflight) {
      return inflight;
    }

    const promise = fetchPage(path)
      .then((page) => {
        const resolvedPath = page.path || path;
        upsertCacheEntry(resolvedPath, page, {
          preparedHtml: resolvedPath === path ? pageCache.get(path)?.preparedHtml : undefined,
          preparedForPath: resolvedPath,
        });
        return { ...page, path: resolvedPath };
      })
      .finally(() => {
        if (inflightLoads.get(path) === promise) {
          inflightLoads.delete(path);
        }
      });

    inflightLoads.set(path, promise);
    return promise;
  };

  const applyActiveEntry = (
    path: string,
    entry: CachedPageEntry,
    pageLoadState?: PageLoadState
  ) => {
    const nextPageLoadState =
      pageLoadState ??
      (isMarkdownKind(entry.page.kind)
        ? entry.preparedHtml
          ? "ready"
          : "preparing"
        : "ready");

    set({
      currentPath: path,
      content: entry.page.content,
      frontmatter: entry.page.frontmatter,
      pageKind: entry.page.kind || "markdown",
      saveStatus: "idle",
      isDirty: entry.dirty,
      pageLoadState: nextPageLoadState,
      preparedHtml: entry.preparedHtml ?? null,
      preparedHtmlVersion: entry.preparedHtml ? ++preparedHtmlVersionSeq : 0,
      activeRevision: entry.revision,
    });
  };

  const queueCurrentIfDirty = (nextPath?: string) => {
    const state = get();
    if (!state.currentPath || !state.isDirty) return;
    if (nextPath && state.currentPath === nextPath) return;
    const snapshot = getSnapshotForPath(state.currentPath);
    if (!snapshot) return;
    void flushSnapshot(snapshot);
  };

  return {
    currentPath: null,
    content: "",
    frontmatter: null,
    pageKind: null,
    saveStatus: "idle",
    isDirty: false,
    pageLoadState: "idle",
    preparedHtml: null,
    preparedHtmlVersion: 0,
    activeRevision: 0,

    loadPage: async (path, options) => {
      queueCurrentIfDirty(path);
      const requestId = ++openRequestSeq;

      const cached = !options?.force ? pageCache.get(path) : undefined;
      if (cached) {
        touchCacheEntry(path, cached);
        applyActiveEntry(path, cached);
        if (isMarkdownKind(cached.page.kind) && !cached.preparedHtml) {
          try {
            await prepareHtmlForPath(path, cached);
            const latest = pageCache.get(path);
            if (!latest) return;
            if (requestId !== openRequestSeq) return;
            if (get().currentPath !== path) return;
            applyActiveEntry(path, latest, "ready");
          } catch {
            if (requestId === openRequestSeq && get().currentPath === path) {
              set({ pageLoadState: "error", preparedHtml: null, preparedHtmlVersion: 0 });
            }
          }
        }
        return;
      }

      set({
        currentPath: path,
        content: "",
        frontmatter: null,
        pageKind: options?.kindHint ?? null,
        saveStatus: "idle",
        isDirty: false,
        pageLoadState: "loading",
        preparedHtml: null,
        preparedHtmlVersion: 0,
        activeRevision: 0,
      });

      try {
        const page = await fetchAndCachePage(path, { force: options?.force });
        const resolvedPath = page.path || path;
        const entry = pageCache.get(resolvedPath);
        if (!entry) throw new Error(`Missing cache entry for ${resolvedPath}`);
        if (requestId !== openRequestSeq) return;

        applyActiveEntry(
          resolvedPath,
          entry,
          isMarkdownKind(entry.page.kind) && !entry.preparedHtml ? "preparing" : "ready"
        );

        if (isMarkdownKind(entry.page.kind) && !entry.preparedHtml) {
          try {
            await prepareHtmlForPath(resolvedPath, entry);
            const latest = pageCache.get(resolvedPath);
            if (!latest) return;
            if (requestId !== openRequestSeq) return;
            if (get().currentPath !== resolvedPath) return;
            applyActiveEntry(resolvedPath, latest, "ready");
          } catch {
            if (requestId === openRequestSeq && get().currentPath === resolvedPath) {
              set({ pageLoadState: "error", preparedHtml: null, preparedHtmlVersion: 0 });
            }
          }
        }
      } catch {
        if (requestId !== openRequestSeq) return;
        set({
          currentPath: path,
          content: "",
          frontmatter: null,
          pageKind: options?.kindHint ?? null,
          saveStatus: "error",
          isDirty: false,
          pageLoadState: "error",
          preparedHtml: null,
          preparedHtmlVersion: 0,
          activeRevision: 0,
        });
      }
    },

    prefetchPage: async (path) => {
      const cached = pageCache.get(path);
      if (cached) {
        touchCacheEntry(path, cached);
        queuePrepareIfNeeded(path);
        return;
      }

      try {
        const page = await fetchAndCachePage(path);
        const resolvedPath = page.path || path;
        queuePrepareIfNeeded(resolvedPath);
      } catch {
        // ignore prefetch failures
      }
    },

    prefetchPages: async (paths) => {
      const uniquePaths = [...new Set(paths.filter(Boolean))];
      await Promise.all(uniquePaths.map((path) => get().prefetchPage(path)));
    },

    updateContent: (content) => {
      const state = get();
      if (!state.currentPath || !state.frontmatter) return;
      const nextRevision = state.activeRevision + 1;
      const pageKind = state.pageKind || "markdown";

      set({
        content,
        isDirty: true,
        saveStatus: "idle",
        activeRevision: nextRevision,
      });

      const cached = pageCache.get(state.currentPath);
      const nextEntry = upsertCacheEntry(
        state.currentPath,
        {
          path: state.currentPath,
          content,
          frontmatter: state.frontmatter,
          kind: pageKind || undefined,
          editable: true,
        },
        {
          dirty: true,
          revision: nextRevision,
          preparedHtml: isMarkdownKind(pageKind) ? undefined : cached?.preparedHtml,
          preparedForPath: state.currentPath,
        }
      );

      nextEntry.page = {
        ...nextEntry.page,
        path: state.currentPath,
        content,
        frontmatter: state.frontmatter,
        kind: pageKind || undefined,
      };
      touchCacheEntry(state.currentPath, nextEntry);
      scheduleSave(state.currentPath);
    },

    updateFrontmatter: (updates) => {
      const state = get();
      if (!state.currentPath || !state.frontmatter) return;

      const nextFrontmatter = { ...state.frontmatter, ...updates };
      const nextRevision = state.activeRevision + 1;
      const pageKind = state.pageKind || "markdown";

      set({
        frontmatter: nextFrontmatter,
        isDirty: true,
        saveStatus: "idle",
        activeRevision: nextRevision,
      });

      const cached = pageCache.get(state.currentPath);
      const nextEntry = upsertCacheEntry(
        state.currentPath,
        {
          path: state.currentPath,
          content: state.content,
          frontmatter: nextFrontmatter,
          kind: pageKind || undefined,
          editable: true,
        },
        {
          dirty: true,
          revision: nextRevision,
          preparedHtml: cached?.preparedHtml,
          preparedForPath: state.currentPath,
        }
      );

      nextEntry.page = {
        ...nextEntry.page,
        path: state.currentPath,
        content: state.content,
        frontmatter: nextFrontmatter,
        kind: pageKind || undefined,
      };
      touchCacheEntry(state.currentPath, nextEntry);
      scheduleSave(state.currentPath);
    },

    save: async () => {
      const state = get();
      if (!state.currentPath || !state.isDirty || !state.frontmatter) return;
      const snapshot = getSnapshotForPath(state.currentPath);
      if (!snapshot) return;
      await flushSnapshot(snapshot, { reportForCurrent: true });
    },

    retryCurrentPage: async () => {
      const currentPath = get().currentPath;
      if (!currentPath) return;
      await get().loadPage(currentPath, { force: true });
    },

    rebasePath: (fromPath, toPath) => {
      const movedEntries = Array.from(pageCache.entries()).filter(
        ([path]) => path === fromPath || path.startsWith(`${fromPath}/`)
      );

      for (const [oldPath, entry] of movedEntries) {
        pageCache.delete(oldPath);
        const newPath = `${toPath}${oldPath.slice(fromPath.length)}`;
        entry.page = {
          ...entry.page,
          path: `${toPath}${entry.page.path.slice(fromPath.length)}`,
          requestedPath: entry.page.requestedPath
            ? `${toPath}${entry.page.requestedPath.slice(fromPath.length)}`
            : entry.page.requestedPath,
        };
        entry.preparedForPath = newPath;
        touchCacheEntry(newPath, entry);
      }

      const movedTimers = Array.from(saveTimersByPath.entries()).filter(
        ([path]) => path === fromPath || path.startsWith(`${fromPath}/`)
      );
      for (const [oldPath, timer] of movedTimers) {
        saveTimersByPath.delete(oldPath);
        const newPath = `${toPath}${oldPath.slice(fromPath.length)}`;
        saveTimersByPath.set(newPath, timer);
      }

      const state = get();
      if (state.currentPath && (state.currentPath === fromPath || state.currentPath.startsWith(`${fromPath}/`))) {
        const nextCurrentPath = `${toPath}${state.currentPath.slice(fromPath.length)}`;
        set({ currentPath: nextCurrentPath });
      }

      trimCache();
    },

    invalidatePath: (path) => {
      for (const key of Array.from(pageCache.keys())) {
        if (matchesPathPrefix(key, path)) {
          pageCache.delete(key);
        }
      }

      for (const key of Array.from(saveTimersByPath.keys())) {
        if (matchesPathPrefix(key, path)) {
          const timer = saveTimersByPath.get(key);
          if (timer) clearTimeout(timer);
          saveTimersByPath.delete(key);
        }
      }

      for (const key of Array.from(inflightLoads.keys())) {
        if (matchesPathPrefix(key, path)) {
          inflightLoads.delete(key);
        }
      }

      for (const key of Array.from(inflightPrepares.keys())) {
        if (matchesPathPrefix(key, path)) {
          inflightPrepares.delete(key);
        }
      }

      for (const key of Array.from(pendingSavesByPath.keys())) {
        if (matchesPathPrefix(key, path)) {
          pendingSavesByPath.delete(key);
        }
      }

      const state = get();
      if (matchesPathPrefix(state.currentPath, path)) {
        set({
          currentPath: null,
          content: "",
          frontmatter: null,
          pageKind: null,
          saveStatus: "idle",
          isDirty: false,
          pageLoadState: "idle",
          preparedHtml: null,
          preparedHtmlVersion: 0,
          activeRevision: 0,
        });
      }
    },

    flushPendingSavesForPrefix: async (path) => {
      const snapshotMap = new Map<string, PageSnapshot>();
      const state = get();
      if (matchesPathPrefix(state.currentPath, path) && state.isDirty && state.frontmatter) {
        const snapshot = getSnapshotForPath(state.currentPath!);
        if (snapshot) snapshotMap.set(snapshot.path, snapshot);
      }

      for (const key of Array.from(saveTimersByPath.keys())) {
        if (!matchesPathPrefix(key, path)) continue;
        const timer = saveTimersByPath.get(key);
        if (timer) clearTimeout(timer);
        saveTimersByPath.delete(key);
        const snapshot = getSnapshotForPath(key);
        if (snapshot) snapshotMap.set(snapshot.path, snapshot);
      }

      await Promise.all(
        Array.from(snapshotMap.values()).map((snapshot) => flushSnapshot(snapshot))
      );

      await Promise.all(
        Array.from(pendingSavesByPath.entries())
          .filter(([key]) => matchesPathPrefix(key, path))
          .map(([, promise]) => promise.catch(() => undefined))
      );
    },

    clear: () => {
      if (statusTimer) {
        clearTimeout(statusTimer);
        statusTimer = null;
      }
      set({
        currentPath: null,
        content: "",
        frontmatter: null,
        pageKind: null,
        saveStatus: "idle",
        isDirty: false,
        pageLoadState: "idle",
        preparedHtml: null,
        preparedHtmlVersion: 0,
        activeRevision: 0,
      });
    },
  };
});
