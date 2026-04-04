"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Sparkles, Code2, Loader2, RotateCcw } from "lucide-react";
import { editorExtensions } from "./extensions";
import { EditorToolbar } from "./editor-toolbar";
import { SlashCommands } from "./slash-commands";
import { TextCodeEditor, getTextEditorLanguage } from "./text-code-editor";
import { useEditorStore } from "@/stores/editor-store";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { useTreeStore } from "@/stores/tree-store";
import { renderMarkdown } from "@/lib/api/client";
import { htmlToMarkdown } from "@/lib/markdown/to-markdown";
import { Button } from "@/components/ui/button";
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

function SaveIndicator({ saveStatus, errorLabel = "Save failed" }: { saveStatus: SaveStatus; errorLabel?: string }) {
  return (
    <div className="flex items-center justify-end px-4 py-1 border-t border-border text-xs text-muted-foreground/60">
      {saveStatus === "saving" && "Saving..."}
      {saveStatus === "saved" && "Saved"}
      {saveStatus === "error" && errorLabel}
    </div>
  );
}

function EmptyEditorState() {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <div className="text-center space-y-3">
        <p className="text-lg font-medium tracking-[-0.02em]">No page selected</p>
        <p className="text-sm text-muted-foreground/70">
          Select a page from the sidebar or create a new one
        </p>
      </div>
    </div>
  );
}

function LoadingEditorState({ label }: { label: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <div className="flex items-center gap-2 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function ErrorEditorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <div className="text-center space-y-3">
        <p className="text-lg font-medium tracking-[-0.02em]">Couldn&apos;t load this page</p>
        <p className="text-sm text-muted-foreground/70">
          Try again. If the file moved or was deleted, refresh the tree and reopen it.
        </p>
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    </div>
  );
}

function TextPageEditor({
  currentPath,
  content,
  saveStatus,
  isRtl,
}: {
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
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border text-[11px] text-muted-foreground">
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
          onChange={(value) => useEditorStore.getState().updateContent(value)}
        />
      </div>
      <SaveIndicator saveStatus={saveStatus} errorLabel="Error saving" />
    </div>
  );
}

function RichPageEditor({
  currentPath,
  preparedHtml,
  preparedHtmlVersion,
  saveStatus,
  isRtl,
}: {
  currentPath: string;
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

  const { open: openAI, clearMessages } = useAIPanelStore();
  const isLoadingRef = useRef(false);
  const appliedPreparedVersionRef = useRef(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState("");

  const handleUpdate = useCallback(
    ({ editor }: { editor: ReturnType<typeof useEditor> }) => {
      if (isLoadingRef.current || !editor) return;
      const html = editor.getHTML();
      const md = htmlToMarkdown(html);
      useEditorStore.getState().updateContent(md);
    },
    []
  );

  const editor = useEditor({
    extensions: editorExtensions,
    content: "",
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class:
          "focus:outline-none min-h-[calc(100vh-12rem)] px-4 sm:px-8 py-6 max-w-3xl mx-auto",
      },
      handlePaste: (_view, event) => {
        const files = event.clipboardData?.files;
        if (!files || files.length === 0) return false;

        const pagePath = useEditorStore.getState().currentPath;
        if (!pagePath) return false;

        for (const file of Array.from(files)) {
          uploadFile(pagePath, file).then((url) => {
            if (!url || !editor) return;
            if (file.type.startsWith("image/")) {
              editor.chain().focus().setImage({ src: url, alt: file.name }).run();
            }
          });
        }
        return true;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;

        const pagePath = useEditorStore.getState().currentPath;
        if (!pagePath) return false;

        event.preventDefault();
        for (const file of Array.from(files)) {
          uploadFile(pagePath, file).then((url) => {
            if (!url || !editor) return;
            if (file.type.startsWith("image/")) {
              editor.chain().focus().setImage({ src: url, alt: file.name }).run();
            }
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
    openAI();
  };

  const toggleSourceMode = async () => {
    if (!sourceMode) {
      setSourceText(useEditorStore.getState().content);
      setSourceMode(true);
      return;
    }

    useEditorStore.getState().updateContent(sourceText);
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
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center">
        <div className="flex-1">{!sourceMode && <EditorToolbar editor={editor} />}</div>
        <button
          onClick={() => {
            void toggleSourceMode();
          }}
          className={`flex items-center gap-1.5 px-3 py-1 mr-2 text-[11px] rounded-md transition-colors border border-border ${
            sourceMode
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent"
          }`}
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
            className="w-full h-full min-h-[calc(100vh-12rem)] bg-transparent font-mono text-[13px] leading-relaxed resize-none focus:outline-none"
            spellCheck={false}
          />
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto relative"
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

          <div className="max-w-3xl mx-auto px-8 pb-8">
            <button
              onClick={handleOpenAI}
              className="group flex items-center gap-2 text-[13px] text-muted-foreground/50 hover:text-muted-foreground transition-colors cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 group-hover:text-primary transition-colors" />
              <span>How would you like to edit this page?</span>
            </button>
          </div>
        </div>
      )}

      <SaveIndicator saveStatus={saveStatus} />
    </div>
  );
}

export function KBEditor() {
  const {
    currentPath,
    content,
    saveStatus,
    frontmatter,
    pageKind,
    pageLoadState,
    preparedHtml,
    preparedHtmlVersion,
    retryCurrentPage,
  } = useEditorStore();
  const isRtl = frontmatter?.dir === "rtl";

  if (!currentPath) {
    return <EmptyEditorState />;
  }

  if (pageLoadState === "error") {
    return <ErrorEditorState onRetry={() => void retryCurrentPage()} />;
  }

  if (pageKind === "text") {
    if (pageLoadState === "loading" && !content) {
      return <LoadingEditorState label="Loading text page..." />;
    }

    return (
      <TextPageEditor
        currentPath={currentPath}
        content={content}
        saveStatus={saveStatus}
        isRtl={isRtl}
      />
    );
  }

  if ((pageLoadState === "loading" || pageLoadState === "preparing") && !preparedHtml) {
    return <LoadingEditorState label="Preparing page..." />;
  }

  if (!preparedHtml) {
    return <LoadingEditorState label="Preparing page..." />;
  }

  return (
    <RichPageEditor
      key={currentPath}
      currentPath={currentPath}
      preparedHtml={preparedHtml}
      preparedHtmlVersion={preparedHtmlVersion}
      saveStatus={saveStatus}
      isRtl={isRtl}
    />
  );
}
