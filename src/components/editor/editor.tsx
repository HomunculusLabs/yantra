"use client";

import { useMemo } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { RichPageEditor } from "./rich-page-editor";
import { SaveIndicator } from "./save-indicator";
import { TextCodeEditor, getTextEditorLanguage } from "./text-code-editor";
import { useEditorStore, type EditorPaneId, type EditorPaneState } from "@/stores/editor-store";
import { getPaneTabDisplayState, paneHasOpenPage } from "@/stores/editor-store.state";
import { useTreeStore } from "@/stores/tree-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SaveStatus, TreeNode } from "@/types";

function getPaneTitle(path: string, pane: EditorPaneState, nodeByPath: Record<string, TreeNode>) {
  return (
    (path === pane.currentPath ? pane.frontmatter?.title : undefined) ||
    nodeByPath[path]?.frontmatter?.title ||
    nodeByPath[path]?.name ||
    path.split("/").pop() ||
    path
  );
}

function EmptyEditorState({
  title = "No page selected",
  description = "Select a page from the sidebar or create a new one",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <div className="text-center">
        <p className="text-lg font-medium tracking-[-0.02em]">{title}</p>
        <p className="mt-3 text-sm text-muted-foreground/70">{description}</p>
      </div>
    </div>
  );
}

function LoadingEditorState({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function ErrorEditorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <div className="text-center">
        <p className="text-lg font-medium tracking-[-0.02em]">Couldn&apos;t load this page</p>
        <p className="mt-3 text-sm text-muted-foreground/70">
          Try again. If the file moved or was deleted, refresh the tree and reopen it.
        </p>
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-4 gap-2">
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    </div>
  );
}

function TextPageEditor({
  paneId,
  currentPath,
  content,
  saveStatus,
  isRtl,
}: {
  paneId: EditorPaneId;
  currentPath: string;
  content: string;
  saveStatus: SaveStatus;
  isRtl?: boolean;
}) {
  const language = useMemo(
    () => getTextEditorLanguage(currentPath, content),
    [currentPath, content]
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span>Syntax-aware text editor</span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {language.label}
        </span>
      </div>
      <div className="flex-1 overflow-hidden" dir={isRtl ? "rtl" : undefined}>
        <TextCodeEditor
          path={currentPath}
          value={content}
          language={language}
          onChange={(value) => useEditorStore.getState().updateContent(value, paneId)}
        />
      </div>
      <SaveIndicator saveStatus={saveStatus} errorLabel="Error saving" />
    </div>
  );
}

function PaneTabs({ paneId, pane, isActive }: { paneId: EditorPaneId; pane: EditorPaneState; isActive: boolean }) {
  const nodeByPath = useTreeStore((state) => state.nodeByPath);
  const activateTab = useEditorStore((state) => state.activateTab);
  const closeTab = useEditorStore((state) => state.closeTab);
  const closePane = useEditorStore((state) => state.closePane);
  const { previewPath, visibleTabs } = getPaneTabDisplayState(pane);

  return (
    <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
        {visibleTabs.length === 0 ? (
          <span className="px-2 text-xs text-muted-foreground/70">
            {paneId === "secondary" ? "Open a file in this pane" : "Open a file"}
          </span>
        ) : (
          visibleTabs.map((path) => {
            const isCurrent = pane.currentPath === path;
            const isPreview = previewPath === path;
            return (
              <button
                key={`${isPreview ? "preview" : "tab"}:${path}`}
                type="button"
                onClick={() => {
                  if (isPreview) return;
                  void activateTab(path, paneId);
                }}
                className={cn(
                  "group flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                  isCurrent
                    ? "border-border bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                  isPreview && "border-dashed border-border/60 bg-muted/40 text-foreground/80"
                )}
              >
                <span className="max-w-[160px] truncate">{getPaneTitle(path, pane, nodeByPath)}</span>
                {isPreview ? null : (
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeTab(path, paneId);
                    }}
                    className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
      {paneId === "secondary" && (visibleTabs.length > 0 || Boolean(pane.currentPath)) ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          onClick={() => closePane("secondary")}
          title="Close right pane"
        >
          <X />
        </Button>
      ) : null}
      {isActive ? <div className="h-2 w-2 shrink-0 rounded-full bg-primary/70" /> : null}
    </div>
  );
}

function EditorPane({ paneId }: { paneId: EditorPaneId }) {
  const pane = useEditorStore((state) => state.panes[paneId]);
  const activePaneId = useEditorStore((state) => state.activePaneId);
  const setActivePane = useEditorStore((state) => state.setActivePane);
  const retryCurrentPage = useEditorStore((state) => state.retryCurrentPage);
  const isActive = activePaneId === paneId;
  const isRtl = pane.frontmatter?.dir === "rtl";

  return (
    <section
      className={cn(
        "flex min-w-0 flex-1 flex-col overflow-hidden bg-background",
        isActive && "ring-1 ring-primary/25 ring-inset"
      )}
      onMouseDown={() => setActivePane(paneId)}
      onFocusCapture={() => setActivePane(paneId)}
    >
      <PaneTabs paneId={paneId} pane={pane} isActive={isActive} />

      {!pane.currentPath ? (
        <EmptyEditorState
          title={paneId === "secondary" ? "Second pane is empty" : "No page selected"}
          description={
            paneId === "secondary"
              ? "Use the split button or right-click a file to open it here"
              : "Select a page from the sidebar or create a new one"
          }
        />
      ) : pane.pageLoadState === "error" ? (
        <ErrorEditorState onRetry={() => void retryCurrentPage(paneId)} />
      ) : pane.pageKind === "text" ? (
        pane.pageLoadState === "loading" && !pane.content ? (
          <LoadingEditorState label="Loading text page..." />
        ) : (
          <TextPageEditor
            paneId={paneId}
            currentPath={pane.currentPath}
            content={pane.content}
            saveStatus={pane.saveStatus}
            isRtl={isRtl}
          />
        )
      ) : (pane.pageLoadState === "loading" || pane.pageLoadState === "preparing") && !pane.preparedHtml ? (
        <LoadingEditorState label="Preparing page..." />
      ) : !pane.preparedHtml ? (
        <LoadingEditorState label="Preparing page..." />
      ) : (
        <RichPageEditor
          key={`${paneId}:${pane.currentPath}`}
          paneId={paneId}
          currentPath={pane.currentPath}
          content={pane.content}
          preparedHtml={pane.preparedHtml}
          preparedHtmlVersion={pane.preparedHtmlVersion}
          saveStatus={pane.saveStatus}
          isRtl={isRtl}
        />
      )}
    </section>
  );
}

export function KBEditor() {
  const isSplitView = useEditorStore((state) => state.isSplitView);
  const secondaryHasOpenPage = useEditorStore((state) => paneHasOpenPage(state.panes.secondary));

  if (!isSplitView || !secondaryHasOpenPage) {
    return <EditorPane paneId="primary" />;
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      <EditorPane paneId="primary" />
      <div className="w-px bg-border" />
      <EditorPane paneId="secondary" />
    </div>
  );
}
