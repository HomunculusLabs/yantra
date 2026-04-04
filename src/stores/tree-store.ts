import { create } from "zustand";
import type { TreeNode, TreeNodeType, VisibleTreeRow } from "@/types";
import {
  fetchTree,
  createPageApi,
  deletePageApi,
  movePageApi,
  renamePageApi,
} from "@/lib/api/client";
import { useEditorStore } from "@/stores/editor-store";
import { useAppStore } from "@/stores/app-store";

type OpenPathSource = "tree-click" | "tree-keyboard" | "search" | "mutation";

interface OpenPathOptions {
  source?: OpenPathSource;
  pane?: "primary" | "secondary";
  openInOtherPane?: boolean;
}

interface TreeState {
  nodes: TreeNode[];
  nodeByPath: Record<string, TreeNode>;
  parentByPath: Record<string, string | null>;
  visibleRows: VisibleTreeRow[];
  visibleIndexByPath: Record<string, number>;
  selectedPath: string | null;
  focusedPath: string | null;
  expandedPaths: Set<string>;
  loading: boolean;
  dragOverPath: string | null;

  loadTree: () => Promise<void>;
  selectPage: (path: string | null) => void;
  setFocusedPath: (path: string | null) => void;
  focusRelative: (delta: -1 | 1) => string | null;
  focusFirst: () => string | null;
  focusLast: () => string | null;
  toggleExpand: (path: string) => void;
  expandPath: (path: string) => void;
  setSubtreeExpanded: (path: string, expanded: boolean) => void;
  revealPath: (path: string) => void;
  openPath: (path: string, options?: OpenPathOptions) => Promise<void>;
  prefetchAroundPath: (path: string) => void;
  createPage: (parentPath: string, title: string) => Promise<string>;
  deletePage: (path: string) => Promise<void>;
  movePage: (fromPath: string, toParentPath: string) => Promise<void>;
  renamePage: (path: string, newName: string) => Promise<void>;
  setDragOver: (path: string | null) => void;
}

function loadExpandedPaths(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem("kb-expanded-paths");
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveExpandedPaths(paths: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem("kb-expanded-paths", JSON.stringify([...paths]));
}

function collectTreeIndexes(
  nodes: TreeNode[],
  parentPath: string | null,
  nodeByPath: Record<string, TreeNode>,
  parentByPath: Record<string, string | null>
) {
  for (const node of nodes) {
    nodeByPath[node.path] = node;
    parentByPath[node.path] = parentPath;
    if (node.children?.length) {
      collectTreeIndexes(node.children, node.path, nodeByPath, parentByPath);
    }
  }
}

function buildVisibleRows(
  nodes: TreeNode[],
  expandedPaths: Set<string>,
  rows: VisibleTreeRow[],
  depth = 0,
  parentPath: string | null = null
) {
  for (const node of nodes) {
    const hasChildren = Boolean(node.children?.length);
    const isExpanded = hasChildren && expandedPaths.has(node.path);
    rows.push({
      path: node.path,
      parentPath,
      depth,
      type: node.type,
      title: node.frontmatter?.title || node.name,
      canOpen: node.canOpen,
      hasChildren,
      isExpanded,
      hasRepo: node.hasRepo,
    });

    if (hasChildren && isExpanded) {
      buildVisibleRows(node.children || [], expandedPaths, rows, depth + 1, node.path);
    }
  }
}

function inferNodeTypeFromPath(path: string): TreeNodeType {
  if (path.endsWith(".pdf")) return "pdf";
  if (path.endsWith(".csv")) return "csv";
  return "file";
}

function isEditorManagedType(type: TreeNodeType) {
  return type === "file" || type === "directory" || type === "text";
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

export const useTreeStore = create<TreeState>((set, get) => {
  const buildDerivedState = (
    nodes: TreeNode[],
    expandedPaths: Set<string>,
    preferredFocusedPath: string | null,
    preferredSelectedPath: string | null,
    fallbackIndex?: number,
    options?: { revealPreferredPaths?: boolean }
  ) => {
    const nodeByPath: Record<string, TreeNode> = {};
    const parentByPath: Record<string, string | null> = {};
    collectTreeIndexes(nodes, null, nodeByPath, parentByPath);

    const effectiveExpandedPaths = new Set(expandedPaths);
    if (options?.revealPreferredPaths) {
      for (const path of [preferredFocusedPath, preferredSelectedPath]) {
        if (!path) continue;
        let current = parentByPath[path] ?? null;
        while (current) {
          effectiveExpandedPaths.add(current);
          current = parentByPath[current] ?? null;
        }
      }
    }

    const visibleRows: VisibleTreeRow[] = [];
    buildVisibleRows(nodes, effectiveExpandedPaths, visibleRows);
    const visibleIndexByPath: Record<string, number> = {};
    visibleRows.forEach((row, index) => {
      visibleIndexByPath[row.path] = index;
    });

    let focusedPath = preferredFocusedPath;
    if (focusedPath && visibleIndexByPath[focusedPath] === undefined) {
      focusedPath = null;
    }

    if (!focusedPath && preferredSelectedPath && visibleIndexByPath[preferredSelectedPath] !== undefined) {
      focusedPath = preferredSelectedPath;
    }

    if (!focusedPath && visibleRows.length > 0) {
      const nextIndex =
        typeof fallbackIndex === "number"
          ? Math.min(Math.max(fallbackIndex, 0), visibleRows.length - 1)
          : 0;
      focusedPath = visibleRows[nextIndex]?.path ?? visibleRows[0]?.path ?? null;
    }

    return {
      nodes,
      nodeByPath,
      parentByPath,
      visibleRows,
      visibleIndexByPath,
      expandedPaths: effectiveExpandedPaths,
      focusedPath,
    };
  };

  const commitExpandedPaths = (expandedPaths: Set<string>) => {
    const state = get();
    const derived = buildDerivedState(
      state.nodes,
      expandedPaths,
      state.focusedPath,
      state.selectedPath,
      state.focusedPath ? state.visibleIndexByPath[state.focusedPath] : undefined
    );
    set(derived);
    saveExpandedPaths(derived.expandedPaths);
  };

  const prefetchEditorNeighbors = (rows: VisibleTreeRow[], path: string) => {
    const index = rows.findIndex((row) => row.path === path);
    if (index === -1) return;

    const windowRows = rows.slice(Math.max(0, index - 1), index + 5);
    const paths = windowRows
      .filter((row) => row.path !== path)
      .filter((row) => row.canOpen && isEditorManagedType(row.type))
      .map((row) => row.path);

    if (paths.length === 0) return;
    void useEditorStore.getState().prefetchPages(paths);
  };

  return {
    nodes: [],
    nodeByPath: {},
    parentByPath: {},
    visibleRows: [],
    visibleIndexByPath: {},
    selectedPath: null,
    focusedPath: null,
    expandedPaths: loadExpandedPaths(),
    loading: false,
    dragOverPath: null,

    loadTree: async () => {
      const state = get();
      const fallbackPath = state.focusedPath || state.selectedPath;
      const fallbackIndex = fallbackPath
        ? state.visibleIndexByPath[fallbackPath]
        : undefined;

      set({ loading: true });
      try {
        const nodes = await fetchTree();
        const latest = get();
        const derived = buildDerivedState(
          nodes,
          latest.expandedPaths,
          latest.focusedPath,
          latest.selectedPath,
          fallbackIndex,
          { revealPreferredPaths: true }
        );
        set({ ...derived, loading: false });
        saveExpandedPaths(derived.expandedPaths);
      } catch {
        set({ loading: false });
      }
    },

    selectPage: (path) => {
      set({ selectedPath: path, focusedPath: path ?? get().focusedPath });
    },

    setFocusedPath: (path) => {
      set({ focusedPath: path });
    },

    focusRelative: (delta) => {
      const state = get();
      if (state.visibleRows.length === 0) return null;

      const anchor = state.focusedPath || state.selectedPath;
      const currentIndex = anchor
        ? state.visibleIndexByPath[anchor] ?? (delta > 0 ? -1 : state.visibleRows.length)
        : delta > 0
          ? -1
          : state.visibleRows.length;
      const nextIndex = Math.min(
        Math.max(currentIndex + delta, 0),
        state.visibleRows.length - 1
      );
      const nextPath = state.visibleRows[nextIndex]?.path ?? null;
      set({ focusedPath: nextPath });
      return nextPath;
    },

    focusFirst: () => {
      const firstPath = get().visibleRows[0]?.path ?? null;
      set({ focusedPath: firstPath });
      return firstPath;
    },

    focusLast: () => {
      const rows = get().visibleRows;
      const lastPath = rows[rows.length - 1]?.path ?? null;
      set({ focusedPath: lastPath });
      return lastPath;
    },

    toggleExpand: (path) => {
      const { expandedPaths } = get();
      const next = new Set(expandedPaths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      commitExpandedPaths(next);
    },

    expandPath: (path) => {
      const { expandedPaths } = get();
      if (expandedPaths.has(path)) return;
      const next = new Set(expandedPaths);
      next.add(path);
      commitExpandedPaths(next);
    },

    setSubtreeExpanded: (path, expanded) => {
      const state = get();
      const next = new Set(state.expandedPaths);
      const walk = (nodePath: string) => {
        const node = state.nodeByPath[nodePath];
        if (!node?.children?.length) return;
        if (expanded) {
          next.add(nodePath);
        } else {
          next.delete(nodePath);
        }
        for (const child of node.children) {
          walk(child.path);
        }
      };
      walk(path);

      let nextFocusedPath = state.focusedPath;
      if (nextFocusedPath && nextFocusedPath.startsWith(`${path}/`)) {
        nextFocusedPath = path;
      }

      const derived = buildDerivedState(
        state.nodes,
        next,
        nextFocusedPath,
        state.selectedPath,
        nextFocusedPath ? state.visibleIndexByPath[nextFocusedPath] : state.visibleIndexByPath[path]
      );
      set(derived);
      saveExpandedPaths(derived.expandedPaths);
    },

    revealPath: (path) => {
      const state = get();
      const next = new Set(state.expandedPaths);
      let changed = false;

      let current = state.parentByPath[path] ?? null;
      while (current) {
        if (!next.has(current)) {
          next.add(current);
          changed = true;
        }
        current = state.parentByPath[current] ?? null;
      }

      if (!changed) {
        const segments = path.split("/").filter(Boolean);
        let prefix = "";
        for (let index = 0; index < segments.length - 1; index += 1) {
          prefix = prefix ? `${prefix}/${segments[index]}` : segments[index];
          const candidate = state.nodeByPath[prefix];
          if (candidate?.type === "directory" && !next.has(prefix)) {
            next.add(prefix);
            changed = true;
          }
        }
      }

      if (!changed) return;
      commitExpandedPaths(next);
    },

    openPath: async (path, options) => {
      get().revealPath(path);
      const latest = get();
      const node = latest.nodeByPath[path];
      const inferredType = node?.type ?? inferNodeTypeFromPath(path);

      set({ focusedPath: path });

      if (node?.type === "directory" && !node.canOpen) {
        return;
      }

      set({ selectedPath: path, focusedPath: path });
      useAppStore.getState().setSection({ type: "page" });

      if (isEditorManagedType(inferredType)) {
        const kindHint =
          inferredType === "text"
            ? "text"
            : inferredType === "directory"
              ? "directory-index"
              : "markdown";

        if (options?.openInOtherPane) {
          await useEditorStore.getState().openInOtherPane(path, {
            source: options?.source,
            kindHint,
          });
        } else {
          await useEditorStore.getState().loadPage(path, {
            source: options?.source,
            kindHint,
            pane: options?.pane,
          });
        }
        get().prefetchAroundPath(path);
      }
    },

    prefetchAroundPath: (path) => {
      prefetchEditorNeighbors(get().visibleRows, path);
    },

    createPage: async (parentPath, title) => {
      const newPath = await createPageApi(parentPath, title);
      if (parentPath) {
        get().expandPath(parentPath);
      }
      await get().loadTree();
      get().revealPath(newPath);
      set({ focusedPath: newPath });
      return newPath;
    },

    deletePage: async (path) => {
      const state = get();
      const fallbackIndex = state.visibleIndexByPath[path];
      const editor = useEditorStore.getState();
      await editor.flushPendingSavesForPrefix(path);

      await deletePageApi(path);
      useEditorStore.getState().invalidatePath(path);

      const nextSelectedPath =
        state.selectedPath === path || state.selectedPath?.startsWith(`${path}/`)
          ? null
          : state.selectedPath;
      const nextFocusedPath =
        state.focusedPath === path || state.focusedPath?.startsWith(`${path}/`)
          ? null
          : state.focusedPath;

      set({ selectedPath: nextSelectedPath, focusedPath: nextFocusedPath });
      await get().loadTree();

      const rows = get().visibleRows;
      if (!get().focusedPath && rows.length > 0) {
        const nextRow = rows[Math.min(fallbackIndex ?? 0, rows.length - 1)];
        set({ focusedPath: nextRow?.path ?? null });
      }
    },

    movePage: async (fromPath, toParentPath) => {
      const editor = useEditorStore.getState();
      await editor.flushPendingSavesForPrefix(fromPath);

      try {
        const newPath = await movePageApi(fromPath, toParentPath);
        if (toParentPath) {
          get().expandPath(toParentPath);
        }

        useEditorStore.getState().rebasePath(fromPath, newPath);
        set((state) => ({
          selectedPath: rebasePathValue(state.selectedPath, fromPath, newPath),
          focusedPath: rebasePathValue(state.focusedPath, fromPath, newPath),
        }));

        await get().loadTree();
        get().revealPath(newPath);
      } catch (error) {
        console.error("Failed to move page:", error);
      }
    },

    renamePage: async (pagePath, newName) => {
      const editor = useEditorStore.getState();
      await editor.flushPendingSavesForPrefix(pagePath);

      try {
        const newPath = await renamePageApi(pagePath, newName);
        useEditorStore.getState().rebasePath(pagePath, newPath);
        set((state) => ({
          selectedPath: rebasePathValue(state.selectedPath, pagePath, newPath),
          focusedPath: rebasePathValue(state.focusedPath, pagePath, newPath),
        }));

        await get().loadTree();
        get().revealPath(newPath);
      } catch (error) {
        console.error("Failed to rename page:", error);
      }
    },

    setDragOver: (path) => {
      set({ dragOverPath: path });
    },
  };
});
