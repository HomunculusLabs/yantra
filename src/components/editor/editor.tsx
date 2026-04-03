"use client";

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { Sparkles, Code2 } from "lucide-react";
import { editorExtensions } from "./extensions";
import { EditorToolbar } from "./editor-toolbar";
import { SlashCommands } from "./slash-commands";
import { TextCodeEditor, getTextEditorLanguage } from "./text-code-editor";
import { useEditorStore } from "@/stores/editor-store";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { markdownToHtml } from "@/lib/markdown/to-html";
import { htmlToMarkdown } from "@/lib/markdown/to-markdown";
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
  content,
  saveStatus,
  isRtl,
}: {
  currentPath: string;
  content: string;
  saveStatus: SaveStatus;
  isRtl?: boolean;
}) {
  const { open: openAI, clearMessages } = useAIPanelStore();
  const isLoadingRef = useRef(false);
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
    },
    immediatelyRender: false,
  });

  const prevPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor || !currentPath) return;
    if (useEditorStore.getState().isDirty && currentPath === prevPathRef.current) return;
    prevPathRef.current = currentPath;

    const setContent = async () => {
      isLoadingRef.current = true;
      const html = await markdownToHtml(content, currentPath);
      editor.commands.setContent(html);
      setTimeout(() => {
        isLoadingRef.current = false;
      }, 50);
    };

    void setContent();
  }, [editor, content, currentPath]);

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
      const html = await markdownToHtml(sourceText, currentPath);
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
            onChange={(e) => setSourceText(e.target.value)}
            className="w-full h-full min-h-[calc(100vh-12rem)] bg-transparent font-mono text-[13px] leading-relaxed resize-none focus:outline-none"
            spellCheck={false}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto relative" dir={isRtl ? "rtl" : undefined}>
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
  const { currentPath, content, saveStatus, frontmatter, pageKind } = useEditorStore();
  const isRtl = frontmatter?.dir === "rtl";

  if (!currentPath) {
    return <EmptyEditorState />;
  }

  if (pageKind === "text") {
    return (
      <TextPageEditor
        currentPath={currentPath}
        content={content}
        saveStatus={saveStatus}
        isRtl={isRtl}
      />
    );
  }

  return (
    <RichPageEditor
      currentPath={currentPath}
      content={content}
      saveStatus={saveStatus}
      isRtl={isRtl}
    />
  );
}
