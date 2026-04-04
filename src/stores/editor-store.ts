import { create } from "zustand";
import type {
  FrontMatter,
  PageData,
  PageLoadState,
  SaveStatus,
} from "@/types";
import { fetchPage, renderMarkdown, savePage } from "@/lib/api/client";

type PageSource = "tree-click" | "tree-keyboard" | "search" | "mutation";
type PageKind = PageData["kind"] | null;

export type EditorPaneId = "primary" | "secondary";

interface LoadPageOptions {
  source?: PageSource;
  kindHint?: "markdown" | "directory-index" | "text";
  force?: boolean;
  pane?: EditorPaneId;
  activatePane?: boolean;
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

export interface EditorPaneState {
  tabs: string[];
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
}

interface EditorState {
  activePaneId: EditorPaneId;
  isSplitView: boolean;
  panes: Record<EditorPaneId, EditorPaneState>;

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

  setActivePane: (paneId: EditorPaneId) => void;
  loadPage: (path: string, options?: LoadPageOptions) => Promise<void>;
  openInOtherPane: (path: string, options?: Omit<LoadPageOptions, "pane">) => Promise<void>;
  toggleSplitWithCurrentPage: () => Promise<void>;
  closePane: (paneId: EditorPaneId) => void;
  activateTab: (path: string, paneId?: EditorPaneId) => Promise<void>;
  closeTab: (path: string, paneId?: EditorPaneId) => Promise<void>;
  prefetchPage: (path: string) => Promise<void>;
  prefetchPages: (paths: string[]) => Promise<void>;
  updateContent: (content: string, paneId?: EditorPaneId) => void;
  updateFrontmatter: (updates: Partial<FrontMatter>, paneId?: EditorPaneId) => void;
  save: (paneId?: EditorPaneId) => Promise<void>;
  retryCurrentPage: (paneId?: EditorPaneId) => Promise<void>;
  rebasePath: (fromPath: string, toPath: string) => void;
  invalidatePath: (path: string) => void;
  flushPendingSavesForPrefix: (path: string) => Promise<void>;
  clear: () => void;
}

const MAX_PAGE_CACHE_ENTRIES = 40;
const MAX_PREPARED_HTML_ENTRIES = 10;
const SAVE_DEBOUNCE_MS = 500;
const PANE_IDS: EditorPaneId[] = ["primary", "secondary"];

const pageCache = new Map<string, CachedPageEntry>();
const inflightLoads = new Map<string, Promise<PageData>>();
const inflightPrepares = new Map<string, Promise<string>>();
const saveTimersByPath = new Map<string, ReturnType<typeof setTimeout>>();
const pendingSavesByPath = new Map<string, Promise<void>>();
const paneStatusTimers: Record<EditorPaneId, ReturnType<typeof setTimeout> | null> = {
  primary: null,
  secondary: null,
};
const openRequestSeq: Record<EditorPaneId, number> = {
  primary: 0,
  secondary: 0,
};
let preparedHtmlVersionSeq = 0;

function createEmptyPaneState(): EditorPaneState {
  return {
    tabs: [],
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
  };
}

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

function uniqueTabs(tabs: string[]) {
  return [...new Set(tabs.filter(Boolean))];
}

function addTab(tabs: string[], path: string) {
  return uniqueTabs([...tabs, path]);
}

function replaceTabPath(tabs: string[], requestedPath: string, resolvedPath: string) {
  const replaced = tabs.map((tab) => (tab === requestedPath ? resolvedPath : tab));
  return addTab(replaced, resolvedPath);
}

function getOtherPaneId(paneId: EditorPaneId): EditorPaneId {
  return paneId === "primary" ? "secondary" : "primary";
}

function rebasePathValue(
  currentPath: string | null,
  fromPath: string,
  toPath: string
): string | null {
  if (!currentPath) return currentPath;
  if (currentPath === fromPath) return toPath;
  if (currentPath.startsWith(`${fromPath}/`)) {
    return `${toPath}${currentPath.slice(fromPath.length)}`;
  }
  return currentPath;
}

export const useEditorStore = create<EditorState>((set, get) => {
  const touchCacheEntry = (path: string, entry: CachedPageEntry) => {
    entry.lastAccessedAt = Date.now();
    pageCache.delete(path);
    pageCache.set(path, entry);
  };

  const getActivePaneFields = (pane: EditorPaneState) => ({
    currentPath: pane.currentPath,
    content: pane.content,
    frontmatter: pane.frontmatter,
    pageKind: pane.pageKind,
    saveStatus: pane.saveStatus,
    isDirty: pane.isDirty,
    pageLoadState: pane.pageLoadState,
    preparedHtml: pane.preparedHtml,
    preparedHtmlVersion: pane.preparedHtmlVersion,
    activeRevision: pane.activeRevision,
  });

  const patchPanes = (
    state: EditorState,
    panePatches: Partial<Record<EditorPaneId, Partial<EditorPaneState>>>,
    extraUpdates: Partial<EditorState> = {}
  ): Partial<EditorState> => {
    const nextPanes = { ...state.panes };

    for (const paneId of PANE_IDS) {
      const panePatch = panePatches[paneId];
      if (!panePatch) continue;
      nextPanes[paneId] = {
        ...nextPanes[paneId],
        ...panePatch,
        tabs: panePatch.tabs ? uniqueTabs(panePatch.tabs) : nextPanes[paneId].tabs,
      };
    }

    const nextState = {
      ...state,
      ...extraUpdates,
      panes: nextPanes,
    };

    return {
      panes: nextPanes,
      ...extraUpdates,
      ...getActivePaneFields(nextPanes[nextState.activePaneId]),
    };
  };

  const trimCache = () => {
    const activePaths = new Set(
      PANE_IDS.map((paneId) => get().panes[paneId].currentPath).filter(Boolean)
    );

    let preparedEntries = Array.from(pageCache.entries()).filter(([, entry]) => entry.preparedHtml);
    for (const [path, entry] of preparedEntries) {
      if (preparedEntries.length <= MAX_PREPARED_HTML_ENTRIES) break;
      if (activePaths.has(path) || entry.dirty || !entry.preparedHtml) continue;
      delete entry.preparedHtml;
      touchCacheEntry(path, entry);
      preparedEntries = Array.from(pageCache.entries()).filter(([, current]) => current.preparedHtml);
    }

    while (pageCache.size > MAX_PAGE_CACHE_ENTRIES) {
      const removable = Array.from(pageCache.entries()).find(
        ([path, entry]) => !activePaths.has(path) && !entry.dirty
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
    for (const paneId of PANE_IDS) {
      const pane = state.panes[paneId];
      if (pane.currentPath === path && pane.frontmatter) {
        return {
          path,
          content: pane.content,
          frontmatter: pane.frontmatter,
          revision: pane.activeRevision,
        };
      }
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

  const clearPaneStatusTimer = (paneId: EditorPaneId) => {
    const timer = paneStatusTimers[paneId];
    if (timer) {
      clearTimeout(timer);
      paneStatusTimers[paneId] = null;
    }
  };

  const markSavedForPath = (path: string, revision: number) => {
    const state = get();
    const panePatches: Partial<Record<EditorPaneId, Partial<EditorPaneState>>> = {};
    const matchingPaneIds = PANE_IDS.filter((paneId) => {
      const pane = state.panes[paneId];
      return pane.currentPath === path && pane.activeRevision === revision;
    });

    if (matchingPaneIds.length === 0) return;

    for (const paneId of matchingPaneIds) {
      panePatches[paneId] = { saveStatus: "saved", isDirty: false };
      clearPaneStatusTimer(paneId);
      paneStatusTimers[paneId] = setTimeout(() => {
        const latest = get();
        const pane = latest.panes[paneId];
        if (pane.currentPath === path && pane.activeRevision === revision) {
          set((current) => patchPanes(current, { [paneId]: { saveStatus: "idle" } }));
        }
      }, 2000);
    }

    set((current) => patchPanes(current, panePatches));
  };

  const flushSnapshot = async (
    snapshot: PageSnapshot,
    options?: { reportForPath?: boolean }
  ) => {
    const previous = pendingSavesByPath.get(snapshot.path) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        if (options?.reportForPath) {
          const state = get();
          const panePatches: Partial<Record<EditorPaneId, Partial<EditorPaneState>>> = {};
          for (const paneId of PANE_IDS) {
            const pane = state.panes[paneId];
            if (pane.currentPath === snapshot.path && pane.activeRevision === snapshot.revision) {
              panePatches[paneId] = { saveStatus: "saving" };
            }
          }
          if (Object.keys(panePatches).length > 0) {
            set((current) => patchPanes(current, panePatches));
          }
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

        markSavedForPath(snapshot.path, snapshot.revision);
      })
      .catch((error) => {
        const state = get();
        const panePatches: Partial<Record<EditorPaneId, Partial<EditorPaneState>>> = {};
        for (const paneId of PANE_IDS) {
          const pane = state.panes[paneId];
          if (pane.currentPath === snapshot.path && pane.activeRevision === snapshot.revision) {
            panePatches[paneId] = { saveStatus: "error" };
          }
        }
        if (Object.keys(panePatches).length > 0) {
          set((current) => patchPanes(current, panePatches));
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
    const promise = renderMarkdown(entry.page.content, path)
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

  const applyPaneEntry = (
    state: EditorState,
    paneId: EditorPaneId,
    requestedPath: string,
    resolvedPath: string,
    entry: CachedPageEntry,
    pageLoadState?: PageLoadState,
    extraUpdates: Partial<EditorState> = {}
  ) => {
    const nextPageLoadState =
      pageLoadState ??
      (isMarkdownKind(entry.page.kind)
        ? entry.preparedHtml
          ? "ready"
          : "preparing"
        : "ready");

    return patchPanes(
      state,
      {
        [paneId]: {
          tabs: replaceTabPath(state.panes[paneId].tabs, requestedPath, resolvedPath),
          currentPath: resolvedPath,
          content: entry.page.content,
          frontmatter: entry.page.frontmatter,
          pageKind: entry.page.kind || "markdown",
          saveStatus: "idle",
          isDirty: entry.dirty,
          pageLoadState: nextPageLoadState,
          preparedHtml: entry.preparedHtml ?? null,
          preparedHtmlVersion: entry.preparedHtml ? ++preparedHtmlVersionSeq : 0,
          activeRevision: entry.revision,
        },
      },
      {
        isSplitView: extraUpdates.isSplitView ?? (state.isSplitView || paneId === "secondary"),
        activePaneId: extraUpdates.activePaneId ?? state.activePaneId,
      }
    );
  };

  const queuePaneIfDirty = (paneId: EditorPaneId, nextPath?: string) => {
    const pane = get().panes[paneId];
    if (!pane.currentPath || !pane.isDirty) return;
    if (nextPath && pane.currentPath === nextPath) return;
    const snapshot = getSnapshotForPath(pane.currentPath);
    if (!snapshot) return;
    void flushSnapshot(snapshot);
  };

  const getPaneSnapshot = (paneId: EditorPaneId) => get().panes[paneId];

  const syncVisiblePanesForPath = (
    path: string,
    panePatch: Partial<EditorPaneState>,
    sourcePaneId: EditorPaneId
  ) => {
    set((state) => {
      const panePatches: Partial<Record<EditorPaneId, Partial<EditorPaneState>>> = {
        [sourcePaneId]: panePatch,
      };

      for (const paneId of PANE_IDS) {
        if (paneId === sourcePaneId) continue;
        if (state.panes[paneId].currentPath === path) {
          panePatches[paneId] = panePatch;
        }
      }

      return patchPanes(state, panePatches);
    });
  };

  return {
    activePaneId: "primary",
    isSplitView: false,
    panes: {
      primary: createEmptyPaneState(),
      secondary: createEmptyPaneState(),
    },

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

    setActivePane: (paneId) => {
      set((state) => {
        if (state.activePaneId === paneId) return {};
        return patchPanes(state, {}, { activePaneId: paneId });
      });
    },

    loadPage: async (path, options) => {
      const paneId = options?.pane ?? get().activePaneId;
      const activatePane = options?.activatePane ?? true;
      const requestId = ++openRequestSeq[paneId];

      queuePaneIfDirty(paneId, path);

      const cached = !options?.force ? pageCache.get(path) : undefined;
      if (cached) {
        touchCacheEntry(path, cached);
        set((state) =>
          applyPaneEntry(state, paneId, path, path, cached, undefined, {
            activePaneId: activatePane ? paneId : state.activePaneId,
          })
        );
        if (isMarkdownKind(cached.page.kind) && !cached.preparedHtml) {
          try {
            await prepareHtmlForPath(path, cached);
            const latest = pageCache.get(path);
            if (!latest) return;
            if (requestId !== openRequestSeq[paneId]) return;
            if (get().panes[paneId].currentPath !== path) return;
            set((state) =>
              applyPaneEntry(state, paneId, path, path, latest, "ready", {
                activePaneId: activatePane ? paneId : state.activePaneId,
              })
            );
          } catch {
            if (requestId === openRequestSeq[paneId] && get().panes[paneId].currentPath === path) {
              set((state) =>
                patchPanes(state, {
                  [paneId]: { pageLoadState: "error", preparedHtml: null, preparedHtmlVersion: 0 },
                })
              );
            }
          }
        }
        return;
      }

      set((state) =>
        patchPanes(
          state,
          {
            [paneId]: {
              tabs: addTab(state.panes[paneId].tabs, path),
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
            },
          },
          {
            activePaneId: activatePane ? paneId : state.activePaneId,
            isSplitView: state.isSplitView || paneId === "secondary",
          }
        )
      );

      try {
        const page = await fetchAndCachePage(path, { force: options?.force });
        const resolvedPath = page.path || path;
        const entry = pageCache.get(resolvedPath);
        if (!entry) throw new Error(`Missing cache entry for ${resolvedPath}`);
        if (requestId !== openRequestSeq[paneId]) return;

        set((state) =>
          applyPaneEntry(
            state,
            paneId,
            path,
            resolvedPath,
            entry,
            isMarkdownKind(entry.page.kind) && !entry.preparedHtml ? "preparing" : "ready",
            { activePaneId: activatePane ? paneId : state.activePaneId }
          )
        );

        if (isMarkdownKind(entry.page.kind) && !entry.preparedHtml) {
          try {
            await prepareHtmlForPath(resolvedPath, entry);
            const latest = pageCache.get(resolvedPath);
            if (!latest) return;
            if (requestId !== openRequestSeq[paneId]) return;
            if (get().panes[paneId].currentPath !== resolvedPath) return;
            set((state) =>
              applyPaneEntry(state, paneId, resolvedPath, resolvedPath, latest, "ready", {
                activePaneId: activatePane ? paneId : state.activePaneId,
              })
            );
          } catch {
            if (
              requestId === openRequestSeq[paneId] &&
              get().panes[paneId].currentPath === resolvedPath
            ) {
              set((state) =>
                patchPanes(state, {
                  [paneId]: { pageLoadState: "error", preparedHtml: null, preparedHtmlVersion: 0 },
                })
              );
            }
          }
        }
      } catch {
        if (requestId !== openRequestSeq[paneId]) return;
        set((state) =>
          patchPanes(
            state,
            {
              [paneId]: {
                tabs: addTab(state.panes[paneId].tabs, path),
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
              },
            },
            {
              activePaneId: activatePane ? paneId : state.activePaneId,
              isSplitView: state.isSplitView || paneId === "secondary",
            }
          )
        );
      }
    },

    openInOtherPane: async (path, options) => {
      const otherPaneId = getOtherPaneId(get().activePaneId);
      await get().loadPage(path, {
        ...options,
        pane: otherPaneId,
        activatePane: true,
      });
    },

    toggleSplitWithCurrentPage: async () => {
      const state = get();
      if (state.isSplitView && state.panes.secondary.tabs.length > 0) {
        get().closePane("secondary");
        return;
      }

      if (!state.currentPath) return;
      await get().loadPage(state.currentPath, {
        pane: "secondary",
        activatePane: true,
      });
    },

    closePane: (paneId) => {
      const pane = getPaneSnapshot(paneId);
      if (pane.currentPath && pane.isDirty) {
        const snapshot = getSnapshotForPath(pane.currentPath);
        if (snapshot) {
          void flushSnapshot(snapshot, { reportForPath: paneId === get().activePaneId });
        }
      }
      clearPaneStatusTimer(paneId);

      set((state) =>
        patchPanes(
          state,
          { [paneId]: createEmptyPaneState() },
          {
            activePaneId: paneId === state.activePaneId ? "primary" : state.activePaneId,
            isSplitView: paneId === "secondary" ? false : state.isSplitView,
          }
        )
      );
    },

    activateTab: async (path, paneId) => {
      await get().loadPage(path, {
        pane: paneId ?? get().activePaneId,
        activatePane: true,
      });
    },

    closeTab: async (path, paneId) => {
      const targetPaneId = paneId ?? get().activePaneId;
      const pane = getPaneSnapshot(targetPaneId);
      if (!pane.tabs.includes(path) && pane.currentPath !== path) return;

      if (pane.currentPath !== path) {
        set((state) =>
          patchPanes(state, {
            [targetPaneId]: {
              tabs: state.panes[targetPaneId].tabs.filter((tab) => tab !== path),
            },
          })
        );
        return;
      }

      if (pane.currentPath && pane.isDirty) {
        const snapshot = getSnapshotForPath(pane.currentPath);
        if (snapshot) {
          void flushSnapshot(snapshot, { reportForPath: targetPaneId === get().activePaneId });
        }
      }

      const nextTabs = pane.tabs.filter((tab) => tab !== path);
      const nextPath = nextTabs[nextTabs.length - 1] ?? null;

      if (!nextPath) {
        clearPaneStatusTimer(targetPaneId);
        set((state) =>
          patchPanes(
            state,
            {
              [targetPaneId]: {
                ...createEmptyPaneState(),
                tabs: [],
              },
            },
            {
              activePaneId:
                targetPaneId === "secondary" && state.activePaneId === "secondary"
                  ? "primary"
                  : state.activePaneId,
              isSplitView:
                targetPaneId === "secondary" ? false : state.isSplitView,
            }
          )
        );
        return;
      }

      const cached = pageCache.get(nextPath);
      if (cached) {
        set((state) =>
          patchPanes(
            state,
            {
              [targetPaneId]: {
                tabs: nextTabs,
              },
            },
            {}
          )
        );
        set((state) =>
          applyPaneEntry(state, targetPaneId, nextPath, nextPath, cached, undefined, {
            activePaneId: state.activePaneId,
          })
        );
        if (isMarkdownKind(cached.page.kind) && !cached.preparedHtml) {
          await get().loadPage(nextPath, {
            pane: targetPaneId,
            activatePane: get().activePaneId === targetPaneId,
          });
        }
        return;
      }

      set((state) =>
        patchPanes(state, {
          [targetPaneId]: {
            tabs: nextTabs,
            currentPath: nextPath,
            content: "",
            frontmatter: null,
            pageKind: null,
            saveStatus: "idle",
            isDirty: false,
            pageLoadState: "loading",
            preparedHtml: null,
            preparedHtmlVersion: 0,
            activeRevision: 0,
          },
        })
      );

      await get().loadPage(nextPath, {
        pane: targetPaneId,
        activatePane: get().activePaneId === targetPaneId,
      });
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

    updateContent: (content, paneId) => {
      const targetPaneId = paneId ?? get().activePaneId;
      const pane = get().panes[targetPaneId];
      if (!pane.currentPath || !pane.frontmatter) return;
      const nextRevision = pane.activeRevision + 1;
      const pageKind = pane.pageKind || "markdown";

      const cached = pageCache.get(pane.currentPath);
      const nextEntry = upsertCacheEntry(
        pane.currentPath,
        {
          path: pane.currentPath,
          content,
          frontmatter: pane.frontmatter,
          kind: pageKind || undefined,
          editable: true,
        },
        {
          dirty: true,
          revision: nextRevision,
          preparedHtml: isMarkdownKind(pageKind) ? undefined : cached?.preparedHtml,
          preparedForPath: pane.currentPath,
        }
      );

      nextEntry.page = {
        ...nextEntry.page,
        path: pane.currentPath,
        content,
        frontmatter: pane.frontmatter,
        kind: pageKind || undefined,
      };
      touchCacheEntry(pane.currentPath, nextEntry);

      syncVisiblePanesForPath(
        pane.currentPath,
        {
          content,
          isDirty: true,
          saveStatus: "idle",
          activeRevision: nextRevision,
        },
        targetPaneId
      );

      scheduleSave(pane.currentPath);
    },

    updateFrontmatter: (updates, paneId) => {
      const targetPaneId = paneId ?? get().activePaneId;
      const pane = get().panes[targetPaneId];
      if (!pane.currentPath || !pane.frontmatter) return;

      const nextFrontmatter = { ...pane.frontmatter, ...updates };
      const nextRevision = pane.activeRevision + 1;
      const pageKind = pane.pageKind || "markdown";

      const cached = pageCache.get(pane.currentPath);
      const nextEntry = upsertCacheEntry(
        pane.currentPath,
        {
          path: pane.currentPath,
          content: pane.content,
          frontmatter: nextFrontmatter,
          kind: pageKind || undefined,
          editable: true,
        },
        {
          dirty: true,
          revision: nextRevision,
          preparedHtml: cached?.preparedHtml,
          preparedForPath: pane.currentPath,
        }
      );

      nextEntry.page = {
        ...nextEntry.page,
        path: pane.currentPath,
        content: pane.content,
        frontmatter: nextFrontmatter,
        kind: pageKind || undefined,
      };
      touchCacheEntry(pane.currentPath, nextEntry);

      syncVisiblePanesForPath(pane.currentPath, {
        frontmatter: nextFrontmatter,
        isDirty: true,
        saveStatus: "idle",
        activeRevision: nextRevision,
      }, targetPaneId);

      scheduleSave(pane.currentPath);
    },

    save: async (paneId) => {
      const targetPaneId = paneId ?? get().activePaneId;
      const pane = get().panes[targetPaneId];
      if (!pane.currentPath || !pane.isDirty || !pane.frontmatter) return;
      const snapshot = getSnapshotForPath(pane.currentPath);
      if (!snapshot) return;
      await flushSnapshot(snapshot, { reportForPath: true });
    },

    retryCurrentPage: async (paneId) => {
      const targetPaneId = paneId ?? get().activePaneId;
      const currentPath = get().panes[targetPaneId].currentPath;
      if (!currentPath) return;
      await get().loadPage(currentPath, { force: true, pane: targetPaneId });
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

      set((state) => {
        const panePatches: Partial<Record<EditorPaneId, Partial<EditorPaneState>>> = {};
        for (const paneId of PANE_IDS) {
          const pane = state.panes[paneId];
          const nextCurrentPath = rebasePathValue(pane.currentPath, fromPath, toPath);
          const nextTabs = uniqueTabs(
            pane.tabs
              .map((tab) => rebasePathValue(tab, fromPath, toPath))
              .filter((tab): tab is string => Boolean(tab))
          );

          if (nextCurrentPath !== pane.currentPath || nextTabs.join("\n") !== pane.tabs.join("\n")) {
            panePatches[paneId] = {
              currentPath: nextCurrentPath,
              tabs: nextTabs,
            };
          }
        }

        return patchPanes(state, panePatches);
      });

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

      const fallbackLoads: Array<{ paneId: EditorPaneId; path: string }> = [];

      set((state) => {
        const panePatches: Partial<Record<EditorPaneId, Partial<EditorPaneState>>> = {};
        let nextIsSplitView = state.isSplitView;
        let nextActivePaneId = state.activePaneId;

        for (const paneId of PANE_IDS) {
          const pane = state.panes[paneId];
          const nextTabs = pane.tabs.filter((tab) => !matchesPathPrefix(tab, path));

          if (!matchesPathPrefix(pane.currentPath, path)) {
            if (nextTabs.length !== pane.tabs.length) {
              panePatches[paneId] = { tabs: nextTabs };
            }
            continue;
          }

          clearPaneStatusTimer(paneId);
          const fallbackPath = nextTabs[nextTabs.length - 1] ?? null;
          if (!fallbackPath) {
            panePatches[paneId] = { ...createEmptyPaneState(), tabs: [] };
            if (paneId === "secondary") {
              nextIsSplitView = false;
              if (nextActivePaneId === "secondary") {
                nextActivePaneId = "primary";
              }
            }
            continue;
          }

          const cached = pageCache.get(fallbackPath);
          if (cached) {
            panePatches[paneId] = {
              tabs: nextTabs,
              currentPath: fallbackPath,
              content: cached.page.content,
              frontmatter: cached.page.frontmatter,
              pageKind: cached.page.kind || "markdown",
              saveStatus: cached.dirty ? pane.saveStatus : "idle",
              isDirty: cached.dirty,
              pageLoadState: isMarkdownKind(cached.page.kind)
                ? cached.preparedHtml
                  ? "ready"
                  : "preparing"
                : "ready",
              preparedHtml: cached.preparedHtml ?? null,
              preparedHtmlVersion: cached.preparedHtml ? ++preparedHtmlVersionSeq : 0,
              activeRevision: cached.revision,
            };
            if (isMarkdownKind(cached.page.kind) && !cached.preparedHtml) {
              fallbackLoads.push({ paneId, path: fallbackPath });
            }
          } else {
            panePatches[paneId] = {
              tabs: nextTabs,
              currentPath: fallbackPath,
              content: "",
              frontmatter: null,
              pageKind: null,
              saveStatus: "idle",
              isDirty: false,
              pageLoadState: "loading",
              preparedHtml: null,
              preparedHtmlVersion: 0,
              activeRevision: 0,
            };
            fallbackLoads.push({ paneId, path: fallbackPath });
          }
        }

        return patchPanes(state, panePatches, {
          isSplitView: nextIsSplitView,
          activePaneId: nextActivePaneId,
        });
      });

      for (const fallbackLoad of fallbackLoads) {
        void get().loadPage(fallbackLoad.path, {
          pane: fallbackLoad.paneId,
          activatePane: get().activePaneId === fallbackLoad.paneId,
        });
      }
    },

    flushPendingSavesForPrefix: async (path) => {
      const snapshotMap = new Map<string, PageSnapshot>();
      const state = get();
      for (const paneId of PANE_IDS) {
        const pane = state.panes[paneId];
        if (matchesPathPrefix(pane.currentPath, path) && pane.isDirty && pane.frontmatter) {
          const snapshot = getSnapshotForPath(pane.currentPath!);
          if (snapshot) snapshotMap.set(snapshot.path, snapshot);
        }
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
      for (const paneId of PANE_IDS) {
        clearPaneStatusTimer(paneId);
      }
      set({
        activePaneId: "primary",
        isSplitView: false,
        panes: {
          primary: createEmptyPaneState(),
          secondary: createEmptyPaneState(),
        },
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
