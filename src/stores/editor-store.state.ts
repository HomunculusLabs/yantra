import type {
  ActivePaneFields,
  EditorPaneId,
  EditorPaneState,
  EditorStateBase,
  OpenMode,
  PageKind,
} from "@/stores/editor-store.types";

export const PANE_IDS: EditorPaneId[] = ["primary", "secondary"];

export function createEmptyPaneState(): EditorPaneState {
  return {
    tabs: [],
    previewPath: null,
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

export function isMarkdownKind(kind: PageKind | undefined) {
  return kind === "markdown" || kind === "directory-index";
}

export function matchesPathPrefix(candidate: string | null | undefined, path: string) {
  if (!candidate) return false;
  return candidate === path || candidate.startsWith(`${path}/`);
}

export function uniqueTabs(tabs: string[]) {
  return [...new Set(tabs.filter(Boolean))];
}

export function addTab(tabs: string[], path: string) {
  return uniqueTabs([...tabs, path]);
}

export function replaceTabPath(tabs: string[], requestedPath: string, resolvedPath: string) {
  const replaced = tabs.map((tab) => (tab === requestedPath ? resolvedPath : tab));
  return addTab(replaced, resolvedPath);
}

export function getPreviewPathForOpen(tabs: string[], path: string, openMode: OpenMode) {
  if (openMode !== "preview") return null;
  return tabs.includes(path) ? null : path;
}

export function getVisiblePreviewPath(tabs: string[], previewPath: string | null | undefined) {
  if (!previewPath) return null;
  return tabs.includes(previewPath) ? null : previewPath;
}

export function isPreviewOnlyPath(pane: EditorPaneState, path: string | null | undefined) {
  if (!path) return false;
  return getVisiblePreviewPath(pane.tabs, pane.previewPath) === path;
}

export function getPaneTabDisplayState(pane: EditorPaneState) {
  const previewPath = getVisiblePreviewPath(pane.tabs, pane.previewPath);
  return {
    previewPath,
    visibleTabs: previewPath ? [previewPath, ...pane.tabs] : pane.tabs,
  };
}

export function getOtherPaneId(paneId: EditorPaneId): EditorPaneId {
  return paneId === "primary" ? "secondary" : "primary";
}

export function rebasePathValue(
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

export function getActivePaneFields(pane: EditorPaneState): ActivePaneFields {
  return {
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
  };
}

export function paneHasOpenPage(pane: EditorPaneState) {
  const { visibleTabs } = getPaneTabDisplayState(pane);
  return Boolean(pane.currentPath || visibleTabs.length > 0);
}

export function patchPanes(
  state: EditorStateBase,
  panePatches: Partial<Record<EditorPaneId, Partial<EditorPaneState>>>,
  extraUpdates: Partial<Pick<EditorStateBase, "activePaneId" | "isSplitView">> = {}
): Partial<EditorStateBase> {
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

  const nextActivePaneId = extraUpdates.activePaneId ?? state.activePaneId;

  return {
    panes: nextPanes,
    ...extraUpdates,
    ...getActivePaneFields(nextPanes[nextActivePaneId]),
  };
}
