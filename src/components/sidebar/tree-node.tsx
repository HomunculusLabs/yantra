"use client";

import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Trash2,
  FilePlus,
  Globe,
  Pencil,
  AppWindow,
  GitBranch,
  FileType,
  Table,
  Copy,
  EyeOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { VisibleTreeRow } from "@/types";
import { useTreeStore } from "@/stores/tree-store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { fetchAbsolutePath } from "@/lib/api/client";

interface TreeNodeRowProps {
  row: VisibleTreeRow;
  rowId: string;
  isFocused: boolean;
  isSelected: boolean;
  onOpen: (event?: React.MouseEvent<HTMLDivElement>) => void;
  onToggleExpand: () => void;
}

function RowIcon({ row }: { row: VisibleTreeRow }) {
  if (row.type === "csv") return <Table className="h-4 w-4 shrink-0 text-green-400" />;
  if (row.type === "pdf") return <FileType className="h-4 w-4 shrink-0 text-red-400" />;
  if (row.type === "app") return <AppWindow className="h-4 w-4 shrink-0 text-emerald-400" />;
  if (row.type === "website") return <Globe className="h-4 w-4 shrink-0 text-blue-400" />;
  if (row.hasRepo) return <GitBranch className="h-4 w-4 shrink-0 text-orange-400" />;
  if (row.hasChildren) {
    return row.isExpanded ? (
      <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
    ) : (
      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
    );
  }
  return <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />;
}

export const TreeNodeRow = memo(function TreeNodeRow({
  row,
  rowId,
  isFocused,
  isSelected,
  onOpen,
  onToggleExpand,
}: TreeNodeRowProps) {
  const deletePage = useTreeStore((s) => s.deletePage);
  const movePage = useTreeStore((s) => s.movePage);
  const setDragOver = useTreeStore((s) => s.setDragOver);
  const createPage = useTreeStore((s) => s.createPage);
  const renamePage = useTreeStore((s) => s.renamePage);
  const hideFolder = useTreeStore((s) => s.hideFolder);
  const openPath = useTreeStore((s) => s.openPath);
  const isDragOver = useTreeStore((s) => s.dragOverPath === row.path);
  const isRecentlyChanged = useTreeStore((s) => s.recentlyChangedPath === row.path);


  const [subPageOpen, setSubPageOpen] = useState(false);
  const [subPageTitle, setSubPageTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState(row.title);
  const [dragging, setDragging] = useState(false);

  const handleDelete = useCallback(() => {
    if (confirm(`Delete "${row.title}"?`)) {
      void deletePage(row.path);
    }
  }, [deletePage, row.path, row.title]);

  const handleCreateSubPage = useCallback(async () => {
    if (!subPageTitle.trim() || row.type !== "directory") return;
    setCreating(true);
    try {
      const newPath = await createPage(row.path, subPageTitle.trim());
      await openPath(newPath, { source: "mutation" });
      setSubPageTitle("");
      setSubPageOpen(false);
    } catch (error) {
      console.error("Failed to create sub page:", error);
    } finally {
      setCreating(false);
    }
  }, [createPage, openPath, row.path, row.type, subPageTitle]);

  const handleCopyPath = useCallback(async () => {
    try {
      const absolutePath = await fetchAbsolutePath(row.path);
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(absolutePath);
        toast.success("Path copied");
        return;
      }
      window.prompt("Copy path:", absolutePath);
    } catch (error) {
      console.error("Failed to copy path:", error);
      toast.error(error instanceof Error ? error.message : "Failed to copy path");
    }
  }, [row.path]);

  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      setDragging(true);
      event.dataTransfer.setData("text/plain", row.path);
      event.dataTransfer.effectAllowed = "move";
    },
    [row.path]
  );

  const handleDragEnd = useCallback(() => {
    setDragging(false);
    setDragOver(null);
  }, [setDragOver]);

  const handleDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDragOver(row.path);
    },
    [row.path, setDragOver]
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (isDragOver) {
        setDragOver(null);
      }
    },
    [isDragOver, setDragOver]
  );

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setDragOver(null);

      const fromPath = event.dataTransfer.getData("text/plain");
      if (!fromPath || fromPath === row.path) return;
      if (fromPath.startsWith(`${row.path}/`)) return;

      const targetParent = row.type === "directory"
        ? row.path
        : row.path.split("/").slice(0, -1).join("/");
      if (fromPath === targetParent) return;

      void movePage(fromPath, targetParent);
    },
    [movePage, row.path, row.type, setDragOver]
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            id={rowId}
            role="treeitem"
            aria-selected={isSelected}
            aria-expanded={row.hasChildren ? row.isExpanded : undefined}
            data-tree-path={row.path}
            draggable
            onClick={onOpen}
            onAuxClick={(event) => {
              if (event.button !== 1) return;
              onOpen(event);
            }}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "flex items-center gap-1.5 py-1.5 pr-2 text-[13px] rounded-md transition-all cursor-pointer",
              "hover:bg-accent/50",
              isSelected && "bg-accent text-accent-foreground font-medium",
              isFocused && "ring-1 ring-primary/40 ring-inset",
              isDragOver && "bg-primary/10 ring-1 ring-primary/30 ring-inset",
              isRecentlyChanged && "animate-in fade-in-0 ring-1 ring-primary/20 ring-inset",
              isRecentlyChanged && !isSelected && !isDragOver && "bg-primary/10",
              dragging && "opacity-50 scale-[0.99]"
            )}
            style={{ paddingLeft: `${row.depth * 16 + 8}px` }}
          >
            {row.hasChildren ? (
              <button
                type="button"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExpand();
                }}
                className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground/70 hover:bg-accent"
                aria-label={row.isExpanded ? "Collapse" : "Expand"}
              >
                <ChevronRight
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 transition-transform duration-150",
                    row.isExpanded && "rotate-90"
                  )}
                />
              </button>
            ) : (
              <span className="w-4" />
            )}
            <RowIcon row={row} />
            <span className="truncate">{row.title}</span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {row.canOpen && (row.type === "file" || row.type === "text" || row.type === "directory") ? (
            <ContextMenuItem onClick={() => void openPath(row.path, { source: "tree-click", openInOtherPane: true })}>
              Open in Other Pane
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem onClick={() => void handleCopyPath()}>
            <Copy className="h-4 w-4 mr-2" />
            Copy Path
          </ContextMenuItem>
          <ContextMenuSeparator />
          {row.type === "directory" && (
            <ContextMenuItem onClick={() => setSubPageOpen(true)}>
              <FilePlus className="h-4 w-4 mr-2" />
              New Note
            </ContextMenuItem>
          )}
          {row.type === "directory" && (
            <ContextMenuItem onClick={() => hideFolder(row.path)}>
              <EyeOff className="h-4 w-4 mr-2" />
              Hide Folder
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onClick={() => {
              setRenameTitle(row.title);
              setRenameOpen(true);
            }}
          >
            <Pencil className="h-4 w-4 mr-2" />
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleDelete} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={subPageOpen} onOpenChange={setSubPageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              New Note in &ldquo;{row.title}&rdquo;
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateSubPage();
            }}
            className="flex gap-2"
          >
            <Input
              placeholder="Page title..."
              value={subPageTitle}
              onChange={(event) => setSubPageTitle(event.target.value)}
              autoFocus
            />
            <Button type="submit" disabled={!subPageTitle.trim() || creating}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!renameTitle.trim()) return;
              await renamePage(row.path, renameTitle.trim());
              setRenameOpen(false);
            }}
            className="flex gap-2"
          >
            <Input
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              autoFocus
            />
            <Button type="submit" disabled={!renameTitle.trim()}>
              Rename
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
});
