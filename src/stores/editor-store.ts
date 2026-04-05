import { create } from "zustand";
import type { FrontMatter, PageLoadState } from "@/types";
import { renderMarkdown, savePage } from "@/lib/api/client";
import {
  fetchAndCachePage,
  inflightLoads,
  pageCache,
  touchCacheEntry,
  trimCache,
  upsertCacheEntry,
} from "@/stores/editor-store.cache";
import {
  addTab,
  createEmptyPaneState,
  getOtherPaneId,
  getPreviewPathForOpen,
  getVisiblePreviewPath,
  isMarkdownKind,
  isPreviewOnlyPath,
  matchesPathPrefix,
  paneHasOpenPage,
  patchPanes,
  PANE_IDS,
  rebasePathValue,
  replaceTabPath,
  uniqueTabs,
} from "@/stores/editor-store.state";
import type {
  CachedPageEntry,
  EditorPaneId,
  EditorPaneState,
  EditorStateBase,
  LoadPageOptions,
  OpenMode,
  PageSnapshot,
} from "@/stores/editor-store.types";

export type { EditorPaneId, EditorPaneState } from "@/stores/editor-store.types";

interface EditorState extends EditorStateBase {
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
  replaceDocument: (
    content: string,
    frontmatter: FrontMatter,
    paneId?: EditorPaneId
  ) => void;
  updateFrontmatter: (updates: Partial<FrontMatter>, paneId?: EditorPaneId) => void;
  save: (paneId?: EditorPaneId) => Promise<void>;
  retryCurrentPage: (paneId?: EditorPaneId) => Promise<void>;
  rebasePath: (fromPath: string, toPath: string) => void;
  invalidatePath: (path: string) => void;
  flushPendingSavesForPrefix: (path: string) => Promise<void>;
  clear: () => void;
}

const SAVE_DEBOUNCE_MS = 500;

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
  const getActivePaths = () =>
    new Set(
      PANE_IDS.map((paneId) => get().panes[paneId].currentPath).filter(
        (path): path is string => Boolean(path)
      )
    );

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
          trimCache(getActivePaths);
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

  const applyPaneEntry = (
    state: EditorState,
    paneId: EditorPaneId,
    requestedPath: string,
    resolvedPath: string,
    entry: CachedPageEntry,
    pageLoadState?: PageLoadState,
    extraUpdates: Partial<EditorState> = {},
    openMode: OpenMode = "tab"
  ) => {
    const nextPageLoadState =
      pageLoadState ??
      (isMarkdownKind(entry.page.kind)
        ? entry.preparedHtml
          ? "ready"
          : "preparing"
        : "ready");

    const pane = state.panes[paneId];
    const nextTabs =
      openMode === "preview"
        ? pane.tabs
        : replaceTabPath(pane.tabs, requestedPath, resolvedPath);
    const nextPreviewPath = getPreviewPathForOpen(nextTabs, resolvedPath, openMode);

    return patchPanes(
      state,
      {
        [paneId]: {
          tabs: nextTabs,
          previewPath: nextPreviewPath,
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
    panePatch: Partial<EditorPaneState>
  ) => {
    set((state) => {
      const panePatches: Partial<Record<EditorPaneId, Partial<EditorPaneState>>> = {};

      for (const paneId of PANE_IDS) {
        if (state.panes[paneId].currentPath !== path) continue;
        const pane = state.panes[paneId];
        const previewPromotion = isPreviewOnlyPath(pane, path)
          ? {
              tabs: addTab(pane.tabs, path),
              previewPath: null,
            }
          : {};

        panePatches[paneId] = {
          ...previewPromotion,
          ...panePatch,
        };
      }

      if (Object.keys(panePatches).length === 0) return {};
      return patchPanes(state, panePatches);
    });
  };

  const replaceDocumentForPane = (
    paneId: EditorPaneId,
    content: string,
    frontmatter: FrontMatter
  ) => {
    const pane = get().panes[paneId];
    if (!pane.currentPath || !pane.frontmatter) return;
    const nextRevision = pane.activeRevision + 1;
    const pageKind = pane.pageKind || "markdown";
    const cached = pageCache.get(pane.currentPath);

    const nextEntry = upsertCacheEntry(
      pane.currentPath,
      {
        path: pane.currentPath,
        content,
        frontmatter,
        kind: pageKind || undefined,
        editable: true,
      },
      getActivePaths,
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
      frontmatter,
      kind: pageKind || undefined,
    };
    touchCacheEntry(pane.currentPath, nextEntry);

    syncVisiblePanesForPath(pane.currentPath, {
      content,
      frontmatter,
      isDirty: true,
      saveStatus: "idle",
      activeRevision: nextRevision,
    });

    scheduleSave(pane.currentPath);
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
      const openMode = options?.openMode ?? "tab";
      const requestId = ++openRequestSeq[paneId];

      queuePaneIfDirty(paneId, path);

      const cached = !options?.force ? pageCache.get(path) : undefined;
      if (cached) {
        touchCacheEntry(path, cached);
        set((state) =>
          applyPaneEntry(
            state,
            paneId,
            path,
            path,
            cached,
            undefined,
            {
              activePaneId: activatePane ? paneId : state.activePaneId,
            },
            openMode
          )
        );
        if (isMarkdownKind(cached.page.kind) && !cached.preparedHtml) {
          try {
            await prepareHtmlForPath(path, cached);
            const latest = pageCache.get(path);
            if (!latest) return;
            if (requestId !== openRequestSeq[paneId]) return;
            if (get().panes[paneId].currentPath !== path) return;
            set((state) =>
              applyPaneEntry(
                state,
                paneId,
                path,
                path,
                latest,
                "ready",
                {
                  activePaneId: activatePane ? paneId : state.activePaneId,
                },
                openMode
              )
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
              tabs:
                openMode === "preview"
                  ? state.panes[paneId].tabs
                  : addTab(state.panes[paneId].tabs, path),
              previewPath: getPreviewPathForOpen(state.panes[paneId].tabs, path, openMode),
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
        const page = await fetchAndCachePage(path, getActivePaths, { force: options?.force });
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
            { activePaneId: activatePane ? paneId : state.activePaneId },
            openMode
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
              applyPaneEntry(
                state,
                paneId,
                resolvedPath,
                resolvedPath,
                latest,
                "ready",
                {
                  activePaneId: activatePane ? paneId : state.activePaneId,
                },
                openMode
              )
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
                tabs:
                  openMode === "preview"
                    ? state.panes[paneId].tabs
                    : addTab(state.panes[paneId].tabs, path),
                previewPath: getPreviewPathForOpen(state.panes[paneId].tabs, path, openMode),
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
      if (state.isSplitView && paneHasOpenPage(state.panes.secondary)) {
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
        const page = await fetchAndCachePage(path, getActivePaths);
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
      replaceDocumentForPane(targetPaneId, content, pane.frontmatter);
    },

    replaceDocument: (content, frontmatter, paneId) => {
      const targetPaneId = paneId ?? get().activePaneId;
      replaceDocumentForPane(targetPaneId, content, frontmatter);
    },

    updateFrontmatter: (updates, paneId) => {
      const targetPaneId = paneId ?? get().activePaneId;
      const pane = get().panes[targetPaneId];
      if (!pane.currentPath || !pane.frontmatter) return;

      replaceDocumentForPane(targetPaneId, pane.content, {
        ...pane.frontmatter,
        ...updates,
      });
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
      const pane = get().panes[targetPaneId];
      const currentPath = pane.currentPath;
      if (!currentPath) return;
      await get().loadPage(currentPath, {
        force: true,
        pane: targetPaneId,
        openMode: isPreviewOnlyPath(pane, currentPath) ? "preview" : "tab",
      });
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
          const rawPreviewPath = rebasePathValue(pane.previewPath, fromPath, toPath);
          const nextPreviewPath = getVisiblePreviewPath(nextTabs, rawPreviewPath);

          if (
            nextCurrentPath !== pane.currentPath ||
            nextTabs.join("\n") !== pane.tabs.join("\n") ||
            nextPreviewPath !== pane.previewPath
          ) {
            panePatches[paneId] = {
              currentPath: nextCurrentPath,
              tabs: nextTabs,
              previewPath: nextPreviewPath,
            };
          }
        }

        return patchPanes(state, panePatches);
      });

      trimCache(getActivePaths);
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
              previewPath: null,
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
              previewPath: null,
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
