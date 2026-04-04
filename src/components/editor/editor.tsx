"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Sparkles, Code2, Loader2, RotateCcw, X } from "lucide-react";
import { editorExtensions } from "./extensions";
import { EditorToolbar } from "./editor-toolbar";
import { SlashCommands } from "./slash-commands";
import { TextCodeEditor, getTextEditorLanguage } from "./text-code-editor";
import { useEditorStore, type EditorPaneId, type EditorPaneState } from "@/stores/editor-store";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { useTreeStore } from "@/stores/tree-store";
import { renderMarkdown } from "@/lib/api/client";
import { htmlToMarkdown } from "@/lib/markdown/to-markdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SaveStatus, TreeNode } from "@/types";

async function uploadFile(pagePath: string, file: File): Promise<string | null> {
  const formData = new FormData();
  formData.append("file", file);
  try {
    const res = await fetch(`/api/upload/${pagePath}`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url;
  } catch {
    return null;
  }
}

function normalizeWikiLinkTarget(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function slugifyWikiLinkTarget(value: string): string {
  return normalizeWikiLinkTarget(value)
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function basenameWithoutExtension(value: string): string {
  const normalized = normalizeWikiLinkTarget(value);
  const basename = normalized.split("/").pop() || normalized;
  return basename.replace(/\.[^.]+$/, "");
}

function isMatchingPath(nodePath: string, target: string): boolean {
  const normalizedNodePath = normalizeWikiLinkTarget(nodePath).toLowerCase();
  const normalizedTarget = normalizeWikiLinkTarget(target).toLowerCase();

  return (
    normalizedNodePath === normalizedTarget ||
    normalizedNodePath === `${normalizedTarget}.md` ||
    normalizedNodePath.replace(/\.md$/i, "") === normalizedTarget
  );
}

function isMatchingDisplayName(node: TreeNode, target: string): boolean {
  const normalizedTarget = normalizeWikiLinkTarget(target).toLowerCase();
  const title = (node.frontmatter?.title || "").trim().toLowerCase();
  const name = basenameWithoutExtension(node.name).toLowerCase();
  const pathName = basenameWithoutExtension(node.path).toLowerCase();

  return title === normalizedTarget || name === normalizedTarget || pathName === normalizedTarget;
}

function isMatchingSlug(node: TreeNode, target: string): boolean {
  const targetSlug = slugifyWikiLinkTarget(target);
  if (!targetSlug) return false;

  const candidates = [
    node.frontmatter?.title || "",
    node.name,
    basenameWithoutExtension(node.path),
    node.path,
  ];

  return candidates.some((candidate) => slugifyWikiLinkTarget(candidate) === targetSlug);
}

function resolveWikiLinkPath(target: string): string | null {
  const normalizedTarget = normalizeWikiLinkTarget(target);
  if (!normalizedTarget) return null;

  const nodes = Object.values(useTreeStore.getState().nodeByPath);
  const matchedPath =
    nodes.find((node) => isMatchingPath(node.path, normalizedTarget))?.path ||
    nodes.find((node) => isMatchingDisplayName(node, normalizedTarget))?.path ||
    nodes.find((node) => isMatchingSlug(node, normalizedTarget))?.path;

  if (matchedPath) return matchedPath;

  const directPathFallback = normalizedTarget.replace(/\.md$/i, "");
  return directPathFallback || null;
}

function getPaneTitle(path: string, pane: EditorPaneState, nodeByPath: Record<string, TreeNode>) {
  return (
    (path === pane.currentPath ? pane.frontmatter?.title : undefined) ||
    nodeByPath[path]?.frontmatter?.title ||
    nodeByPath[path]?.name ||
    path.split("/").pop() ||
    path
  );
}

function SaveIndicator({ saveStatus, errorLabel = "Save failed" }: { saveStatus: SaveStatus; errorLabel?: string }) {
  return (
    <div className="flex items-center justify-end border-t border-border px-4 py-1 text-xs text-muted-foreground/60">
      {saveStatus === "saving" && "Saving..."}
      {saveStatus === "saved" && "Saved"}
      {saveStatus === "error" && errorLabel}
    </div>
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

function RichPageEditor({
  paneId,
  currentPath,
  content,
  preparedHtml,
  preparedHtmlVersion,
  saveStatus,
  isRtl,
}: {
  paneId: EditorPaneId;
  currentPath: string;
  content: string;
  preparedHtml: string;
  preparedHtmlVersion: number;
  saveStatus: SaveStatus;
  isRtl?: boolean;
}) {
  const handleWikiLinkOpen = useCallback((target: EventTarget | null) => {
    const element =
      target instanceof Element
        ? target
        : target instanceof Node
          ? target.parentElement
          : null;
    if (!element) return false;

    const link = element.closest('a[data-wiki-link="true"]');
    if (!(link instanceof HTMLAnchorElement)) return false;

    const rawTarget =
      link.getAttribute("data-page-path") ||
      link.getAttribute("data-page-name") ||
      link.textContent ||
      "";
    const resolvedPath = resolveWikiLinkPath(rawTarget);

    if (!resolvedPath) {
      console.warn("Could not resolve wiki link target:", rawTarget);
      return true;
    }

    void useTreeStore.getState().openPath(resolvedPath, { source: "search" });
    return true;
  }, []);

  const openEditorPanel = useAIPanelStore((state) => state.openEditorPanel);
  const clearMessages = useAIPanelStore((state) => state.clearMessages);
  const isLoadingRef = useRef(false);
  const appliedPreparedVersionRef = useRef(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState("");

  const handleUpdate = useCallback(
    ({ editor }: { editor: ReturnType<typeof useEditor> }) => {
      if (isLoadingRef.current || !editor) return;
      const html = editor.getHTML();
      const md = htmlToMarkdown(html);
      useEditorStore.getState().updateContent(md, paneId);
    },
    [paneId]
  );

  const editor = useEditor({
    extensions: editorExtensions,
    content: "",
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class:
          "focus:outline-none min-h-[calc(100vh-12rem)] px-4 py-6 sm:px-8 max-w-3xl mx-auto",
      },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (!files || files.length === 0) return false;

        for (const file of Array.from(files)) {
          uploadFile(currentPath, file).then((url) => {
            if (!url || !editor || !file.type.startsWith("image/")) return;
            editor.chain().focus().setImage({ src: url, alt: file.name }).run();
          });
        }
        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;

        event.preventDefault();
        for (const file of Array.from(files)) {
          uploadFile(currentPath, file).then((url) => {
            if (!url || !editor || !file.type.startsWith("image/")) return;
            editor.chain().focus().setImage({ src: url, alt: file.name }).run();
          });
        }
        return true;
      },
      handleClick: (_view, _pos, event) => {
        const handled = handleWikiLinkOpen(event.target);
        if (!handled) return false;
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor || !preparedHtml || preparedHtmlVersion === 0) return;
    if (appliedPreparedVersionRef.current === preparedHtmlVersion) return;

    appliedPreparedVersionRef.current = preparedHtmlVersion;
    isLoadingRef.current = true;
    editor.commands.setContent(preparedHtml);
    setTimeout(() => {
      isLoadingRef.current = false;
    }, 50);
  }, [editor, preparedHtml, preparedHtmlVersion]);

  const handleOpenAI = () => {
    clearMessages();
    openEditorPanel();
  };

  const toggleSourceMode = async () => {
    if (!sourceMode) {
      setSourceText(content);
      setSourceMode(true);
      return;
    }

    useEditorStore.getState().updateContent(sourceText, paneId);
    if (editor) {
      isLoadingRef.current = true;
      const html = await renderMarkdown(sourceText, currentPath);
      editor.commands.setContent(html);
      setTimeout(() => {
        isLoadingRef.current = false;
      }, 50);
    }
    setSourceMode(false);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center border-b border-border">
        <div className="min-w-0 flex-1">{!sourceMode && <EditorToolbar editor={editor} paneId={paneId} />}</div>
        <button
          onClick={() => {
            void toggleSourceMode();
          }}
          className={cn(
            "mr-2 flex items-center gap-1.5 rounded-md border border-border px-3 py-1 text-[11px] transition-colors",
            sourceMode
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          )}
        >
          <Code2 className="h-3 w-3" />
          {sourceMode ? "Preview" : "Source"}
        </button>
      </div>

      {sourceMode ? (
        <div className="flex-1 overflow-y-auto p-4" dir={isRtl ? "rtl" : undefined}>
          <textarea
            value={sourceText}
            onChange={(event) => setSourceText(event.target.value)}
            className="min-h-[calc(100vh-12rem)] h-full w-full resize-none bg-transparent font-mono text-[13px] leading-relaxed focus:outline-none"
            spellCheck={false}
          />
        </div>
      ) : (
        <div
          className="relative flex-1 overflow-y-auto"
          dir={isRtl ? "rtl" : undefined}
          onClickCapture={(event) => {
            const handled = handleWikiLinkOpen(event.target);
            if (!handled) return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onMouseDownCapture={(event) => {
            if (!(event.target instanceof Element)) return;
            if (!event.target.closest('a[data-wiki-link="true"]')) return;
            event.preventDefault();
          }}
        >
          <EditorContent editor={editor} />
          <SlashCommands editor={editor} />

          <div className="mx-auto max-w-3xl px-8 pb-8">
            <button
              onClick={handleOpenAI}
              className="group flex items-center gap-2 text-[13px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
            >
              <Sparkles className="h-3.5 w-3.5 transition-colors group-hover:text-primary" />
              <span>How would you like to edit this page?</span>
            </button>
          </div>
        </div>
      )}

      <SaveIndicator saveStatus={saveStatus} />
    </div>
  );
}

function PaneTabs({ paneId, pane, isActive }: { paneId: EditorPaneId; pane: EditorPaneState; isActive: boolean }) {
  const nodeByPath = useTreeStore((state) => state.nodeByPath);
  const activateTab = useEditorStore((state) => state.activateTab);
  const closeTab = useEditorStore((state) => state.closeTab);
  const closePane = useEditorStore((state) => state.closePane);

  return (
    <div className="flex items-center gap-1 border-b border-border bg-muted/30 px-2 py-1">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scrollbar-none">
        {pane.tabs.length === 0 ? (
          <span className="px-2 text-xs text-muted-foreground/70">
            {paneId === "secondary" ? "Open a file in this pane" : "Open a file"}
          </span>
        ) : (
          pane.tabs.map((path) => {
            const isCurrent = pane.currentPath === path;
            return (
              <button
                key={path}
                type="button"
                onClick={() => void activateTab(path, paneId)}
                className={cn(
                  "group flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors",
                  isCurrent
                    ? "border-border bg-background text-foreground"
                    : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <span className="max-w-[160px] truncate">{getPaneTitle(path, pane, nodeByPath)}</span>
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
              </button>
            );
          })
        )}
      </div>
      {paneId === "secondary" && pane.tabs.length > 0 ? (
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
  const secondaryHasTabs = useEditorStore((state) => state.panes.secondary.tabs.length > 0);

  if (!isSplitView || !secondaryHasTabs) {
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
