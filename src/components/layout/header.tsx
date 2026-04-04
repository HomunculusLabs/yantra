"use client";

import {
  Sparkles,
  Bot,
  Copy,
  Download,
  Search,
  FileCode,
  Terminal,
  FileDown,
  Columns2,
  History,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditorStore } from "@/stores/editor-store";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { useAppStore } from "@/stores/app-store";
import { useTreeStore } from "@/stores/tree-store";
import { VersionHistory } from "@/components/editor/version-history";
import { ThemePicker } from "@/components/layout/theme-picker";
import { renderMarkdown } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export function Header() {
  const {
    frontmatter,
    content,
    currentPath,
    pageLoadState,
    preparedHtml,
    pageKind,
    isSplitView,
    toggleSplitWithCurrentPage,
  } = useEditorStore();
  const selectedNode = useTreeStore((s) =>
    s.selectedPath ? s.nodeByPath[s.selectedPath] ?? null : null
  );
  const isOpen = useAIPanelStore((s) => s.isOpen);
  const mode = useAIPanelStore((s) => s.mode);
  const closePanel = useAIPanelStore((s) => s.close);
  const openEditorPanel = useAIPanelStore((s) => s.openEditorPanel);
  const openAgentPanel = useAIPanelStore((s) => s.openAgentPanel);
  const openTasksPanel = useAIPanelStore((s) => s.openTasksPanel);
  const { terminalOpen, toggleTerminal } = useAppStore();

  const isBusy = pageLoadState === "loading" || pageLoadState === "preparing";
  const title =
    frontmatter?.title ||
    selectedNode?.frontmatter?.title ||
    selectedNode?.name ||
    currentPath?.split("/").pop() ||
    "Yantra";

  const handleCopyMarkdown = async () => {
    if (!content || isBusy) return;
    await navigator.clipboard.writeText(content);
  };

  const handleCopyHTML = async () => {
    if (!currentPath || isBusy) return;
    if (preparedHtml && (pageKind === "markdown" || pageKind === "directory-index")) {
      await navigator.clipboard.writeText(preparedHtml);
      return;
    }

    const res = await fetch(`/api/pages/${currentPath}`);
    if (!res.ok) return;
    const data = await res.json();
    const html = await renderMarkdown(data.content, currentPath);
    await navigator.clipboard.writeText(html);
  };

  const handleDownloadMarkdown = () => {
    if (!content || !frontmatter || isBusy) return;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${frontmatter.title || "page"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-2 bg-background/80 backdrop-blur-sm">
      <div className="flex items-center gap-2 min-w-0">
        <h1 className="text-[13px] font-medium text-foreground truncate tracking-[-0.01em]">
          {title}
        </h1>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground hidden sm:flex"
          onClick={() => {
            window.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", metaKey: true })
            );
          }}
        >
          <Search className="h-3.5 w-3.5" />
          <kbd className="pointer-events-none text-[10px] font-mono bg-muted px-1 py-0.5 rounded">
            ⌘K
          </kbd>
        </Button>

        {currentPath && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={isBusy}
              className={cn(
                "inline-flex items-center justify-center rounded-md h-8 w-8 transition-colors cursor-pointer",
                isBusy
                  ? "opacity-50 pointer-events-none"
                  : "hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Download className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={isBusy} onClick={handleCopyMarkdown}>
                <Copy className="h-4 w-4 mr-2" />
                Copy Markdown
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isBusy} onClick={handleCopyHTML}>
                <FileCode className="h-4 w-4 mr-2" />
                Copy as HTML
              </DropdownMenuItem>
              <DropdownMenuItem disabled={isBusy} onClick={handleDownloadMarkdown}>
                <Download className="h-4 w-4 mr-2" />
                Download .md
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isBusy}
                onClick={async () => {
                  if (isBusy) return;
                  const editorEl = document.querySelector(".tiptap");
                  if (!editorEl) return;
                  const html2canvas = (await import("html2canvas")).default;
                  const { jsPDF } = await import("jspdf");
                  const canvas = await html2canvas(editorEl as HTMLElement, {
                    backgroundColor: "#ffffff",
                    scale: 2,
                  });
                  const imgData = canvas.toDataURL("image/png");
                  const pdf = new jsPDF("p", "mm", "a4");
                  const pdfWidth = pdf.internal.pageSize.getWidth();
                  const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
                  pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
                  pdf.save(`${frontmatter?.title || "page"}.pdf`);
                }}
              >
                <FileDown className="h-4 w-4 mr-2" />
                Download PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {currentPath && <VersionHistory />}

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", currentPath && isSplitView && "text-primary")}
          onClick={() => {
            void toggleSplitWithCurrentPage();
          }}
          disabled={!currentPath}
          title={isSplitView ? "Close split view" : "Open current file in a second pane"}
        >
          <Columns2 className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", terminalOpen && "text-primary")}
          onClick={toggleTerminal}
        >
          <Terminal className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", isOpen && mode === "agents" && "text-primary")}
          onClick={() => {
            if (isOpen && mode === "agents") {
              closePanel();
              return;
            }
            openAgentPanel(null);
          }}
          title="Open agent sidebar"
        >
          <Bot className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", isOpen && mode === "tasks" && "text-primary")}
          onClick={() => {
            if (isOpen && mode === "tasks") {
              closePanel();
              return;
            }
            openTasksPanel();
          }}
          title="Open recent tasks"
        >
          <History className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", isOpen && mode === "editor" && "text-primary")}
          onClick={() => {
            if (isOpen && mode === "editor") {
              closePanel();
              return;
            }
            openEditorPanel();
          }}
          title="Open AI editor"
        >
          <Sparkles className="h-4 w-4" />
        </Button>

        <ThemePicker />
      </div>
    </header>
  );
}
