import { create } from "zustand";
import type { TreeNode, TreeNodeType, VisibleTreeRow } from "@/types";
import {
  fetchTree,
  createPageApi,
  deletePageApi,
  movePageApi,
  renamePageApi,
} from "@/lib/api/client";
import { toast } from "sonner";
import { useEditorStore } from "@/stores/editor-store";
import { useAppStore } from "@/stores/app-store";

type OpenPathSource = "tree-click" | "tree-keyboard" | "search" | "mutation";

interface OpenPathOptions {
  source?: OpenPathSource;
  pane?: "primary" | "secondary";
  openInOtherPane?: boolean;
  openMode?: "tab" | "preview";
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
  hiddenFolderPaths: Set<string>;
  loading: boolean;
  dragOverPath: string | null;
  recentlyChangedPath: string | null;

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
  hideFolder: (path: string) => void;
  unhideFolder: (path: string) => void;
  clearHiddenFolders: () => void;
  setDragOver: (path: string | null) => void;
}

let recentChangeTimer: ReturnType<typeof setTimeout> | null = null;

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

function loadHiddenFolderPaths(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const stored = localStorage.getItem("kb-hidden-folders");
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveHiddenFolderPaths(paths: Set<string>) {
  if (typeof window === "undefined") return;
  localStorage.setItem("kb-hidden-folders", JSON.stringify([...paths]));
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
  hiddenFolderPaths: Set<string>,
  rows: VisibleTreeRow[],
  depth = 0,
  parentPath: string | null = null
) {
  for (const node of nodes) {
    if (node.type === "directory" && hiddenFolderPaths.has(node.path)) {
      continue;
    }
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
      buildVisibleRows(node.children || [], expandedPaths, hiddenFolderPaths, rows, depth + 1, node.path);
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

function rebaseExpandedPaths(
  expandedPaths: Set<string>,
  fromPath: string,
  toPath: string
) {
  const next = new Set<string>();
  for (const value of expandedPaths) {
    next.add(rebasePathValue(value, fromPath, toPath) ?? value);
  }
  return next;
}

function pruneExpandedPaths(expandedPaths: Set<string>, removedPath: string) {
  const next = new Set<string>();
  for (const value of expandedPaths) {
    if (value === removedPath || value.startsWith(`${removedPath}/`)) continue;
    next.add(value);
  }
  return next;
}

function compareTreeNodes(a: TreeNode, b: TreeNode) {
  const orderA = a.frontmatter?.order ?? 999;
  const orderB = b.frontmatter?.order ?? 999;
  if (orderA !== orderB) return orderA - orderB;
  const nameA = a.frontmatter?.title || a.name;
  const nameB = b.frontmatter?.title || b.name;
  return nameA.localeCompare(nameB);
}

function sortTreeNodes(nodes: TreeNode[]) {
  return [...nodes].sort(compareTreeNodes);
}

function virtualBasename(virtualPath: string) {
  return virtualPath.split("/").filter(Boolean).pop() || virtualPath;
}

function deriveNodeTitle(type: TreeNodeType, leafName: string) {
  if (type === "file") return leafName.replace(/\.md$/i, "");
  if (type === "pdf") return leafName.replace(/\.pdf$/i, "");
  if (type === "csv") return leafName.replace(/\.csv$/i, "");
  return leafName;
}

function cloneTreeNode(node: TreeNode): TreeNode {
  return {
    ...node,
    frontmatter: node.frontmatter ? { ...node.frontmatter } : undefined,
    children: node.children?.map(cloneTreeNode),
  };
}

function rebaseTreeNodePaths(node: TreeNode, fromPath: string, toPath: string): TreeNode {
  const nextPath =
    node.path === fromPath
      ? toPath
      : node.path.startsWith(`${fromPath}/`)
        ? `${toPath}${node.path.slice(fromPath.length)}`
        : node.path;

  return {
    ...node,
    path: nextPath,
    children: node.children?.map((child) => rebaseTreeNodePaths(child, fromPath, toPath)),
  };
}

function updateTreeNodeForPath(node: TreeNode, nextPath: string): TreeNode {
  const leafName = virtualBasename(nextPath);
  const title = deriveNodeTitle(node.type, leafName);
  return {
    ...node,
    name: leafName,
    path: nextPath,
    frontmatter: {
      ...(node.frontmatter ?? {}),
      title,
    },
  };
}

type TreeMutationResult = {
  nodes: TreeNode[];
  changed: boolean;
  removedNode: TreeNode | null;
};

type TreeInsertResult = {
  nodes: TreeNode[];
  inserted: boolean;
};

function removeTreeNode(nodes: TreeNode[], targetPath: string): TreeMutationResult {
  let changed = false;
  let removedNode: TreeNode | null = null;
  const nextNodes: TreeNode[] = [];

  for (const node of nodes) {
    if (node.path === targetPath) {
      removedNode = cloneTreeNode(node);
      changed = true;
      continue;
    }

    if (node.children?.length) {
      const childResult = removeTreeNode(node.children, targetPath);
      if (childResult.changed) {
        changed = true;
        removedNode = childResult.removedNode;
        nextNodes.push({
          ...node,
          children: childResult.nodes,
        });
        continue;
      }
    }

    nextNodes.push(node);
  }

  return {
    nodes: changed ? nextNodes : nodes,
    changed,
    removedNode,
  };
}

function insertTreeNode(
  nodes: TreeNode[],
  parentPath: string,
  nodeToInsert: TreeNode
): TreeInsertResult {
  if (!parentPath) {
    return {
      nodes: sortTreeNodes([...nodes, nodeToInsert]),
      inserted: true,
    };
  }

  let inserted = false;
  const nextNodes: TreeNode[] = nodes.map((node) => {
    if (node.path === parentPath) {
      inserted = true;
      return {
        ...node,
        children: sortTreeNodes([...(node.children ?? []), nodeToInsert]),
      };
    }

    if (node.children?.length) {
      const childResult: TreeInsertResult = insertTreeNode(node.children, parentPath, nodeToInsert);
      if (childResult.inserted) {
        inserted = true;
        return {
          ...node,
          children: childResult.nodes,
        };
      }
    }

    return node;
  });

  return {
    nodes: inserted ? nextNodes : nodes,
    inserted,
  };
}

export const useTreeStore = create<TreeState>((set, get) => {
  const buildDerivedState = (
    nodes: TreeNode[],
    expandedPaths: Set<string>,
    preferredFocusedPath: string | null,
    preferredSelectedPath: string | null,
    fallbackIndex?: number,
    options?: { revealPreferredPaths?: boolean; hiddenFolderPaths?: Set<string> }
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

    const hiddenFolderPaths = options?.hiddenFolderPaths ?? get().hiddenFolderPaths;
    const visibleRows: VisibleTreeRow[] = [];
    buildVisibleRows(nodes, effectiveExpandedPaths, hiddenFolderPaths, visibleRows);
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
      state.focusedPath ? state.visibleIndexByPath[state.focusedPath] : undefined,
      { hiddenFolderPaths: state.hiddenFolderPaths }
    );
    set(derived);
    saveExpandedPaths(derived.expandedPaths);
  };

  const commitNodes = (
    nodes: TreeNode[],
    options?: {
      focusedPath?: string | null;
      selectedPath?: string | null;
      fallbackIndex?: number;
      revealPreferredPaths?: boolean;
      expandedPaths?: Set<string>;
      hiddenFolderPaths?: Set<string>;
    }
  ) => {
    const state = get();
    const derived = buildDerivedState(
      nodes,
      options?.expandedPaths ?? state.expandedPaths,
      options?.focusedPath ?? state.focusedPath,
      options?.selectedPath ?? state.selectedPath,
      options?.fallbackIndex,
      options?.revealPreferredPaths
        ? {
            revealPreferredPaths: true,
            hiddenFolderPaths: options?.hiddenFolderPaths ?? state.hiddenFolderPaths,
          }
        : { hiddenFolderPaths: options?.hiddenFolderPaths ?? state.hiddenFolderPaths }
    );
    set({
      ...derived,
      selectedPath: options?.selectedPath ?? state.selectedPath,
      hiddenFolderPaths: options?.hiddenFolderPaths ?? state.hiddenFolderPaths,
    });
    saveExpandedPaths(derived.expandedPaths);
    return derived;
  };

  const markRecentlyChanged = (path: string | null) => {
    if (recentChangeTimer) {
      clearTimeout(recentChangeTimer);
      recentChangeTimer = null;
    }

    set({ recentlyChangedPath: path });
    if (!path) return;

    recentChangeTimer = setTimeout(() => {
      if (get().recentlyChangedPath === path) {
        set({ recentlyChangedPath: null });
      }
    }, 1400);
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
    hiddenFolderPaths: loadHiddenFolderPaths(),
    loading: false,
    dragOverPath: null,
    recentlyChangedPath: null,

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
          { revealPreferredPaths: true, hiddenFolderPaths: latest.hiddenFolderPaths }
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
        nextFocusedPath ? state.visibleIndexByPath[nextFocusedPath] : state.visibleIndexByPath[path],
        { hiddenFolderPaths: state.hiddenFolderPaths }
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
            openMode: options?.openMode,
          });
        } else {
          await useEditorStore.getState().loadPage(path, {
            source: options?.source,
            kindHint,
            pane: options?.pane,
            openMode: options?.openMode,
          });
        }
        get().prefetchAroundPath(path);
      }
    },

    prefetchAroundPath: (path) => {
      prefetchEditorNeighbors(get().visibleRows, path);
    },

    createPage: async (parentPath, title) => {
      try {
        const newPath = await createPageApi(parentPath, title);
        const state = get();
        const newNode: TreeNode = {
          name: virtualBasename(newPath),
          path: newPath,
          type: "file",
          canOpen: true,
          frontmatter: {
            title: title.trim() || deriveNodeTitle("file", virtualBasename(newPath)),
          },
        };

        const inserted = insertTreeNode(state.nodes, parentPath, newNode);
        if (inserted.inserted) {
          commitNodes(inserted.nodes, {
            focusedPath: newPath,
            selectedPath: state.selectedPath,
            revealPreferredPaths: true,
          });
        } else {
          await get().loadTree();
          get().revealPath(newPath);
          set({ focusedPath: newPath });
        }

        markRecentlyChanged(newPath);
        toast.success(`Created “${title.trim() || deriveNodeTitle("file", virtualBasename(newPath))}”`);
        return newPath;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to create note";
        toast.error(message);
        throw error;
      }
    },

    deletePage: async (path) => {
      const state = get();
      const fallbackIndex = state.visibleIndexByPath[path];
      const editor = useEditorStore.getState();
      const deletedTitle =
        state.nodeByPath[path]?.frontmatter?.title ||
        state.nodeByPath[path]?.name ||
        virtualBasename(path);

      try {
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
        const removed = removeTreeNode(state.nodes, path);
        const nextExpandedPaths = pruneExpandedPaths(state.expandedPaths, path);
        const nextHiddenFolderPaths = pruneExpandedPaths(state.hiddenFolderPaths, path);

        if (removed.changed) {
          const derived = commitNodes(removed.nodes, {
            selectedPath: nextSelectedPath,
            focusedPath: nextFocusedPath,
            fallbackIndex,
            expandedPaths: nextExpandedPaths,
            hiddenFolderPaths: nextHiddenFolderPaths,
          });
          markRecentlyChanged(derived.focusedPath);
        } else {
          set({
            selectedPath: nextSelectedPath,
            focusedPath: nextFocusedPath,
            expandedPaths: nextExpandedPaths,
            hiddenFolderPaths: nextHiddenFolderPaths,
          });
          saveHiddenFolderPaths(nextHiddenFolderPaths);
          await get().loadTree();
          markRecentlyChanged(get().focusedPath);
        }

        saveHiddenFolderPaths(nextHiddenFolderPaths);
        toast.success(`Deleted “${deletedTitle}”`);
      } catch (error) {
        console.error("Failed to delete node:", error);
        toast.error(error instanceof Error ? error.message : "Failed to delete item");
      }
    },

    movePage: async (fromPath, toParentPath) => {
      const editor = useEditorStore.getState();

      try {
        await editor.flushPendingSavesForPrefix(fromPath);
        const newPath = await movePageApi(fromPath, toParentPath);
        const state = get();
        const removed = removeTreeNode(state.nodes, fromPath);

        useEditorStore.getState().rebasePath(fromPath, newPath);
        const nextSelectedPath = rebasePathValue(state.selectedPath, fromPath, newPath);
        const nextFocusedPath = rebasePathValue(state.focusedPath, fromPath, newPath);
        const nextExpandedPaths = rebaseExpandedPaths(state.expandedPaths, fromPath, newPath);
        const nextHiddenFolderPaths = rebaseExpandedPaths(state.hiddenFolderPaths, fromPath, newPath);

        if (removed.removedNode) {
          const movedNode = rebaseTreeNodePaths(removed.removedNode, fromPath, newPath);
          const targetParentPath = newPath.split("/").slice(0, -1).join("/");
          const inserted = insertTreeNode(removed.nodes, targetParentPath, movedNode);

          if (inserted.inserted) {
            commitNodes(inserted.nodes, {
              selectedPath: nextSelectedPath,
              focusedPath: nextFocusedPath,
              revealPreferredPaths: true,
              expandedPaths: nextExpandedPaths,
              hiddenFolderPaths: nextHiddenFolderPaths,
            });
            saveHiddenFolderPaths(nextHiddenFolderPaths);
            markRecentlyChanged(newPath);
            toast.success(`Moved “${state.nodeByPath[fromPath]?.frontmatter?.title || state.nodeByPath[fromPath]?.name || virtualBasename(newPath)}”`);
            return;
          }
        }

        set({
          selectedPath: nextSelectedPath,
          focusedPath: nextFocusedPath,
          expandedPaths: nextExpandedPaths,
          hiddenFolderPaths: nextHiddenFolderPaths,
        });
        saveHiddenFolderPaths(nextHiddenFolderPaths);
        await get().loadTree();
        get().revealPath(newPath);
        markRecentlyChanged(newPath);
        toast.success(`Moved “${state.nodeByPath[fromPath]?.frontmatter?.title || state.nodeByPath[fromPath]?.name || virtualBasename(newPath)}”`);
      } catch (error) {
        console.error("Failed to move node:", error);
        toast.error(error instanceof Error ? error.message : "Failed to move item");
      }
    },

    renamePage: async (pagePath, newName) => {
      const editor = useEditorStore.getState();

      try {
        await editor.flushPendingSavesForPrefix(pagePath);
        const newPath = await renamePageApi(pagePath, newName);
        const state = get();
        const removed = removeTreeNode(state.nodes, pagePath);

        useEditorStore.getState().rebasePath(pagePath, newPath);
        const nextSelectedPath = rebasePathValue(state.selectedPath, pagePath, newPath);
        const nextFocusedPath = rebasePathValue(state.focusedPath, pagePath, newPath);
        const nextExpandedPaths = rebaseExpandedPaths(state.expandedPaths, pagePath, newPath);
        const nextHiddenFolderPaths = rebaseExpandedPaths(state.hiddenFolderPaths, pagePath, newPath);

        if (removed.removedNode) {
          const renamedNode = updateTreeNodeForPath(
            rebaseTreeNodePaths(removed.removedNode, pagePath, newPath),
            newPath
          );
          const targetParentPath = newPath.split("/").slice(0, -1).join("/");
          const inserted = insertTreeNode(removed.nodes, targetParentPath, renamedNode);

          if (inserted.inserted) {
            commitNodes(inserted.nodes, {
              selectedPath: nextSelectedPath,
              focusedPath: nextFocusedPath,
              revealPreferredPaths: true,
              expandedPaths: nextExpandedPaths,
              hiddenFolderPaths: nextHiddenFolderPaths,
            });
            saveHiddenFolderPaths(nextHiddenFolderPaths);
            markRecentlyChanged(newPath);
            toast.success(`Renamed to “${deriveNodeTitle(renamedNode.type, virtualBasename(newPath))}”`);
            return;
          }
        }

        set({
          selectedPath: nextSelectedPath,
          focusedPath: nextFocusedPath,
          expandedPaths: nextExpandedPaths,
          hiddenFolderPaths: nextHiddenFolderPaths,
        });
        saveHiddenFolderPaths(nextHiddenFolderPaths);
        await get().loadTree();
        get().revealPath(newPath);
        markRecentlyChanged(newPath);
        toast.success(`Renamed to “${deriveNodeTitle(inferNodeTypeFromPath(newPath), virtualBasename(newPath))}”`);
      } catch (error) {
        console.error("Failed to rename node:", error);
        toast.error(error instanceof Error ? error.message : "Failed to rename item");
      }
    },

    hideFolder: (path) => {
      const state = get();
      const node = state.nodeByPath[path];
      if (node?.type !== "directory") return;
      if (state.hiddenFolderPaths.has(path)) return;

      const nextHiddenFolderPaths = new Set(state.hiddenFolderPaths);
      nextHiddenFolderPaths.add(path);
      saveHiddenFolderPaths(nextHiddenFolderPaths);

      const nextSelectedPath =
        state.selectedPath === path || state.selectedPath?.startsWith(`${path}/`)
          ? state.parentByPath[path] ?? null
          : state.selectedPath;
      const nextFocusedPath =
        state.focusedPath === path || state.focusedPath?.startsWith(`${path}/`)
          ? state.parentByPath[path] ?? null
          : state.focusedPath;

      const derived = commitNodes(state.nodes, {
        selectedPath: nextSelectedPath,
        focusedPath: nextFocusedPath,
        fallbackIndex: state.visibleIndexByPath[path],
        hiddenFolderPaths: nextHiddenFolderPaths,
      });
      markRecentlyChanged(derived.focusedPath);
      toast.success(`Hid “${node.frontmatter?.title || node.name}”`);
    },

    unhideFolder: (path) => {
      const state = get();
      if (!state.hiddenFolderPaths.has(path)) return;

      const nextHiddenFolderPaths = new Set(state.hiddenFolderPaths);
      nextHiddenFolderPaths.delete(path);
      saveHiddenFolderPaths(nextHiddenFolderPaths);

      commitNodes(state.nodes, {
        focusedPath: path,
        selectedPath: state.selectedPath,
        hiddenFolderPaths: nextHiddenFolderPaths,
        revealPreferredPaths: true,
      });
      markRecentlyChanged(path);
      toast.success(`Unhid “${state.nodeByPath[path]?.frontmatter?.title || state.nodeByPath[path]?.name || virtualBasename(path)}”`);
    },

    clearHiddenFolders: () => {
      const state = get();
      if (state.hiddenFolderPaths.size === 0) return;
      saveHiddenFolderPaths(new Set());
      commitNodes(state.nodes, {
        hiddenFolderPaths: new Set(),
        selectedPath: state.selectedPath,
        focusedPath: state.focusedPath,
      });
      toast.success("Unhid all folders");
    },

    setDragOver: (path) => {
      set({ dragOverPath: path });
    },
  };
});
