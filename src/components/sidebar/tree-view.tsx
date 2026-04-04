"use client";

import { memo, useCallback, useEffect, useRef } from "react";
import { useTreeStore } from "@/stores/tree-store";
import { TreeNodeRow } from "./tree-node";

export const KB_TREE_ROOT_ID = "kb-tree-root";

function escapeAttributeValue(value: string) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/([\\"#.:\[\]])/g, "\\$1");
}

export const TreeView = memo(function TreeView() {
  const visibleRows = useTreeStore((s) => s.visibleRows);
  const loading = useTreeStore((s) => s.loading);
  const focusedPath = useTreeStore((s) => s.focusedPath);
  const selectedPath = useTreeStore((s) => s.selectedPath);
  const setFocusedPath = useTreeStore((s) => s.setFocusedPath);
  const focusRelative = useTreeStore((s) => s.focusRelative);
  const focusFirst = useTreeStore((s) => s.focusFirst);
  const focusLast = useTreeStore((s) => s.focusLast);
  const openPath = useTreeStore((s) => s.openPath);
  const toggleExpand = useTreeStore((s) => s.toggleExpand);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingOpenPathRef = useRef<string | null>(null);

  const scheduleFollowOpen = useCallback((path: string | null) => {
    if (!path) return;
    pendingOpenPathRef.current = path;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const candidate = pendingOpenPathRef.current;
      if (!candidate) return;
      const row = useTreeStore.getState().visibleRows.find((item) => item.path === candidate);
      if (!row?.canOpen) return;
      void useTreeStore.getState().openPath(candidate, { source: "tree-keyboard" });
    });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!focusedPath || !containerRef.current) return;
    const selector = `[data-tree-path="${escapeAttributeValue(focusedPath)}"]`;
    const row = containerRef.current.querySelector<HTMLElement>(selector);
    row?.scrollIntoView({ block: "nearest" });
  }, [focusedPath]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const state = useTreeStore.getState();
      const anchorPath = state.focusedPath || state.selectedPath || state.visibleRows[0]?.path || null;
      const currentRow = anchorPath
        ? state.visibleRows[state.visibleIndexByPath[anchorPath] ?? 0]
        : undefined;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        scheduleFollowOpen(focusRelative(1));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        scheduleFollowOpen(focusRelative(-1));
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        scheduleFollowOpen(focusFirst());
        return;
      }

      if (event.key === "End") {
        event.preventDefault();
        scheduleFollowOpen(focusLast());
        return;
      }

      if (!currentRow) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (currentRow.hasChildren && !currentRow.isExpanded) {
          toggleExpand(currentRow.path);
          return;
        }
        if (currentRow.hasChildren && currentRow.isExpanded) {
          const currentIndex = state.visibleIndexByPath[currentRow.path];
          const nextRow = state.visibleRows[currentIndex + 1];
          if (nextRow?.parentPath === currentRow.path) {
            setFocusedPath(nextRow.path);
          }
        }
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (currentRow.hasChildren && currentRow.isExpanded) {
          toggleExpand(currentRow.path);
          return;
        }
        if (currentRow.parentPath) {
          setFocusedPath(currentRow.parentPath);
        }
        return;
      }

      if (event.key === "Enter" || event.key === " ") {
        if (!currentRow.canOpen) return;
        event.preventDefault();
        void openPath(currentRow.path, { source: "tree-keyboard" });
      }
    },
    [focusFirst, focusLast, focusRelative, openPath, scheduleFollowOpen, setFocusedPath, toggleExpand]
  );

  const handleFocus = useCallback(() => {
    const state = useTreeStore.getState();
    if (state.focusedPath || state.visibleRows.length === 0) return;
    setFocusedPath(state.selectedPath || state.visibleRows[0]?.path || null);
  }, [setFocusedPath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div
      id={KB_TREE_ROOT_ID}
      ref={containerRef}
      tabIndex={0}
      role="tree"
      aria-activedescendant={focusedPath ? `${KB_TREE_ROOT_ID}-row-${focusedPath}` : undefined}
      data-kb-tree-root="true"
      className="flex-1 min-h-0 overflow-y-auto py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
    >
      {visibleRows.map((row) => (
        <TreeNodeRow
          key={row.path}
          row={row}
          rowId={`${KB_TREE_ROOT_ID}-row-${row.path}`}
          isFocused={focusedPath === row.path}
          isSelected={selectedPath === row.path}
          onOpen={() => {
            if (row.hasChildren) {
              toggleExpand(row.path);
            }
            if (row.type === "directory" && !row.canOpen) {
              setFocusedPath(row.path);
              return;
            }
            void openPath(row.path, { source: "tree-click" });
          }}
          onToggleExpand={() => toggleExpand(row.path)}
        />
      ))}
    </div>
  );
});
