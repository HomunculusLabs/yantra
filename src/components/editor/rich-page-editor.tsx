"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Code2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { editorExtensions } from "./extensions";
import { EditorToolbar } from "./editor-toolbar";
import { SaveIndicator } from "./save-indicator";
import { SlashCommands } from "./slash-commands";
import { renderMarkdown } from "@/lib/api/client";
import {
  parseMarkdownFrontmatter,
  stringifyMarkdownWithFrontmatter,
} from "@/lib/markdown/frontmatter";
import { htmlToMarkdown } from "@/lib/markdown/to-markdown";
import { cn } from "@/lib/utils";
import { resolveWikiLinkPath } from "@/lib/wiki-links";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { useEditorStore, type EditorPaneId } from "@/stores/editor-store";
import { useTreeStore } from "@/stores/tree-store";
import type { SaveStatus } from "@/types";

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

function resolveWikiLinkTarget(target: string): string | null {
  const nodes = Object.values(useTreeStore.getState().nodeByPath);
  return resolveWikiLinkPath(target, nodes, { allowMissingFallback: true });
}

function findWikiLinkAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null;

  if (!element) return null;

  const link = element.closest('a[data-wiki-link="true"]');
  return link instanceof HTMLAnchorElement ? link : null;
}

function queueTransferredFiles(
  pagePath: string,
  files: FileList | null | undefined,
  insertImage: (url: string, fileName: string) => void
) {
  if (!files || files.length === 0) return false;

  for (const file of Array.from(files)) {
    void uploadFile(pagePath, file).then((url) => {
      if (!url || !file.type.startsWith("image/")) return;
      insertImage(url, file.name);
    });
  }

  return true;
}

type RichPageEditorProps = {
  paneId: EditorPaneId;
  currentPath: string;
  content: string;
  preparedHtml: string;
  preparedHtmlVersion: number;
  saveStatus: SaveStatus;
  isRtl?: boolean;
};

type RichEditorInstance = NonNullable<ReturnType<typeof useEditor>>;

export function RichPageEditor({
  paneId,
  currentPath,
  content,
  preparedHtml,
  preparedHtmlVersion,
  saveStatus,
  isRtl,
}: RichPageEditorProps) {
  const openEditorPanel = useAIPanelStore((state) => state.openEditorPanel);
  const clearMessages = useAIPanelStore((state) => state.clearMessages);
  const paneFrontmatter = useEditorStore((state) => state.panes[paneId].frontmatter);
  const replaceDocument = useEditorStore((state) => state.replaceDocument);
  const isLoadingRef = useRef(false);
  const loadingResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedPreparedVersionRef = useRef(0);
  const sourcePreviewRequestSeqRef = useRef(0);
  const [sourceMode, setSourceMode] = useState(false);
  const [sourceText, setSourceText] = useState("");

  const clearLoadingState = useCallback(() => {
    if (loadingResetTimerRef.current) {
      clearTimeout(loadingResetTimerRef.current);
      loadingResetTimerRef.current = null;
    }
    isLoadingRef.current = false;
  }, []);

  const scheduleLoadingReset = useCallback(() => {
    if (loadingResetTimerRef.current) {
      clearTimeout(loadingResetTimerRef.current);
    }

    loadingResetTimerRef.current = setTimeout(() => {
      loadingResetTimerRef.current = null;
      isLoadingRef.current = false;
    }, 50);
  }, []);

  const handleUpdate = useCallback(
    ({ editor }: { editor: RichEditorInstance }) => {
      if (isLoadingRef.current) return;
      const html = editor.getHTML();
      const md = htmlToMarkdown(html);
      useEditorStore.getState().updateContent(md, paneId);
    },
    [paneId]
  );

  const openWikiLinkTarget = useCallback((target: EventTarget | null) => {
    const link = findWikiLinkAnchor(target);
    if (!link) return false;

    const rawTarget =
      link.getAttribute("data-page-path") ||
      link.getAttribute("data-page-name") ||
      link.textContent ||
      "";
    const resolvedPath = resolveWikiLinkTarget(rawTarget);

    if (!resolvedPath) {
      console.warn("Could not resolve wiki link target:", rawTarget);
      return true;
    }

    void useTreeStore.getState().openPath(resolvedPath, { source: "search" });
    return true;
  }, []);

  const editor = useEditor({
    extensions: editorExtensions,
    content: "",
    onUpdate: handleUpdate,
    editorProps: {
      attributes: {
        class:
          "focus:outline-none min-h-[calc(100vh-12rem)] px-4 py-6 sm:px-8 max-w-3xl mx-auto",
      },
      handlePaste: (_view, event) =>
        queueTransferredFiles(currentPath, event.clipboardData?.files, (url, fileName) => {
          editor?.chain().focus().setImage({ src: url, alt: fileName }).run();
        }),
      handleDrop: (_view, event) => {
        const handled = queueTransferredFiles(currentPath, event.dataTransfer?.files, (url, fileName) => {
          editor?.chain().focus().setImage({ src: url, alt: fileName }).run();
        });

        if (handled) {
          event.preventDefault();
        }

        return handled;
      },
      handleClick: (_view, _pos, event) => {
        if (event.defaultPrevented) return false;
        const handled = openWikiLinkTarget(event.target);
        if (!handled) return false;
        event.preventDefault();
        event.stopPropagation();
        return true;
      },
    },
    immediatelyRender: false,
  });

  const applyHtmlToEditor = useCallback(
    (html: string) => {
      if (!editor) return;
      isLoadingRef.current = true;
      editor.commands.setContent(html);
      scheduleLoadingReset();
    },
    [editor, scheduleLoadingReset]
  );

  useEffect(() => {
    return () => {
      sourcePreviewRequestSeqRef.current += 1;
      clearLoadingState();
    };
  }, [clearLoadingState]);

  useEffect(() => {
    if (!editor || !preparedHtml || preparedHtmlVersion === 0) return;
    if (appliedPreparedVersionRef.current === preparedHtmlVersion) return;

    appliedPreparedVersionRef.current = preparedHtmlVersion;
    applyHtmlToEditor(preparedHtml);
  }, [applyHtmlToEditor, editor, preparedHtml, preparedHtmlVersion]);

  const handleOpenAI = useCallback(() => {
    clearMessages();
    openEditorPanel();
  }, [clearMessages, openEditorPanel]);

  const toggleSourceMode = useCallback(async () => {
    if (!sourceMode) {
      setSourceText(stringifyMarkdownWithFrontmatter(content, paneFrontmatter));
      setSourceMode(true);
      return;
    }

    if (!editor) {
      setSourceMode(false);
      return;
    }

    const requestSeq = ++sourcePreviewRequestSeqRef.current;

    try {
      const parsed = parseMarkdownFrontmatter(sourceText);
      replaceDocument(parsed.content, parsed.frontmatter, paneId);
      const html = await renderMarkdown(sourceText, currentPath);
      if (requestSeq !== sourcePreviewRequestSeqRef.current) return;
      applyHtmlToEditor(html);
      setSourceMode(false);
    } catch (error) {
      if (requestSeq === sourcePreviewRequestSeqRef.current) {
        clearLoadingState();
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not parse frontmatter. Fix the YAML and try again."
        );
      }
    }
  }, [applyHtmlToEditor, clearLoadingState, content, currentPath, editor, paneFrontmatter, paneId, replaceDocument, sourceMode, sourceText]);

  const handleWikiLinkMouseDownCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (!findWikiLinkAnchor(event.target)) return;
    event.preventDefault();
  }, []);

  const handleWikiLinkClickCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (event.defaultPrevented) return;
      const handled = openWikiLinkTarget(event.target);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [openWikiLinkTarget]
  );

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
          onClickCapture={handleWikiLinkClickCapture}
          onMouseDownCapture={handleWikiLinkMouseDownCapture}
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
