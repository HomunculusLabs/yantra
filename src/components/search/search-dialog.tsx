"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Search,
  FileText,
  Tag,
  X,
  Sparkles,
  Loader2,
  Puzzle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { listPluginCommands } from "@/lib/api/plugins-client";
import { useTreeStore } from "@/stores/tree-store";
import { useEditorStore } from "@/stores/editor-store";
import { useUIStore } from "@/stores/ui-store";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";
import type { PluginRuntimeCommand } from "@/types/plugins";

interface SearchResult {
  path: string;
  title: string;
  snippet: string;
  tags: string[];
  modified?: string;
}

type CommandResult = PluginRuntimeCommand;

type DialogItem =
  | {
      kind: "page";
      key: string;
      result: SearchResult;
    }
  | {
      kind: "command";
      key: string;
      result: CommandResult;
    };

export function SearchDialog() {
  const open = useUIStore((s) => s.activeDialog === "search");
  const setOpen = useUIStore((s) => s.setSearchOpen);
  const openPluginView = useAppStore((s) => s.openPluginView);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pluginCommands, setPluginCommands] = useState<PluginRuntimeCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [aiSearching, setAiSearching] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const prefetchRef = useRef<ReturnType<typeof setTimeout>>(null);
  const openPath = useTreeStore((s) => s.openPath);
  const prefetchPage = useEditorStore((s) => s.prefetchPage);

  const isCommandMode = query.trim().startsWith(">") && !tagFilter;
  const commandQuery = isCommandMode ? query.trim().slice(1).trim().toLowerCase() : "";

  const commandResults = useMemo(() => {
    if (!isCommandMode) return [];
    if (!commandQuery) return pluginCommands;
    return pluginCommands.filter((command) => {
      const haystack = [command.title, command.pluginName, command.pluginId, command.id]
        .join(" ")
        .toLowerCase();
      return haystack.includes(commandQuery);
    });
  }, [commandQuery, isCommandMode, pluginCommands]);

  const items = useMemo<DialogItem[]>(() => {
    if (isCommandMode) {
      return commandResults.map((result) => ({
        kind: "command",
        key: result.id,
        result,
      }));
    }
    return results.map((result) => ({
      kind: "page",
      key: result.path,
      result,
    }));
  }, [commandResults, isCommandMode, results]);

  useEffect(() => {
    if (!open || isCommandMode) return;
    const selected = items[selectedIndex];
    if (!selected || selected.kind !== "page") return;
    if (prefetchRef.current) clearTimeout(prefetchRef.current);
    prefetchRef.current = setTimeout(() => {
      void prefetchPage(selected.result.path);
    }, 80);
    return () => {
      if (prefetchRef.current) clearTimeout(prefetchRef.current);
    };
  }, [isCommandMode, items, open, prefetchPage, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void listPluginCommands()
      .then((response) => {
        if (!cancelled) {
          setPluginCommands(response.commands);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPluginCommands([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const search = useCallback(async (q: string, tag: string) => {
    if (!q.trim() && !tag) {
      setResults([]);
      return;
    }
    if (q.trim().startsWith(">")) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q);
      if (tag) params.set("tag", tag);
      const res = await fetch(`/api/search?${params}`);
      if (res.ok) {
        const data = await res.json();
        setResults(data);
        setSelectedIndex(0);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setAiResult("");
    setSelectedIndex(0);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value, tagFilter), 200);
  };

  const handleSelectPage = async (result: SearchResult) => {
    await openPath(result.path, { source: "search" });
    setOpen(false);
    setQuery("");
    setTagFilter("");
    setResults([]);
  };

  const handleSelectCommand = (result: CommandResult) => {
    openPluginView({
      entryKey: result.pluginEntryKey,
      viewId: result.viewId,
    });
    setOpen(false);
    setQuery("");
    setTagFilter("");
    setResults([]);
  };

  const handleSetTag = (tag: string) => {
    setTagFilter(tag);
    setSelectedIndex(0);
    search(query, tag);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => Math.min(index + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && items[selectedIndex]) {
      event.preventDefault();
      const selected = items[selectedIndex];
      if (selected.kind === "page") {
        void handleSelectPage(selected.result);
      } else {
        handleSelectCommand(selected.result);
      }
    }
  };

  const allTags = Array.from(new Set(results.flatMap((result) => result.tags))).slice(0, 8);
  const showResults = items.length > 0 || loading;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setQuery("");
          setTagFilter("");
          setResults([]);
          setSelectedIndex(0);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages... or type > for plugin commands"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0 text-[13px] h-11"
            autoFocus
          />
        </div>

        {tagFilter && (
          <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border">
            <Tag className="h-3 w-3 text-muted-foreground" />
            <span className="text-[11px] bg-primary/10 text-primary px-1.5 py-0.5 rounded flex items-center gap-1">
              {tagFilter}
              <button onClick={() => handleSetTag("")}>
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          </div>
        )}

        {showResults && (
          <div className="max-h-[300px] overflow-y-auto py-1">
            {loading && items.length === 0 && !isCommandMode && (
              <div className="px-4 py-3 text-[13px] text-muted-foreground">Searching...</div>
            )}
            {items.map((item, index) =>
              item.kind === "page" ? (
                <button
                  key={item.key}
                  onClick={() => {
                    void handleSelectPage(item.result);
                  }}
                  className={cn(
                    "flex items-start gap-3 w-full px-3 py-2.5 text-left transition-colors",
                    index === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                >
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{item.result.title}</div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {item.result.snippet}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] text-muted-foreground/50">{item.result.path}</span>
                      {item.result.tags.map((tag) => (
                        <span
                          key={tag}
                          role="button"
                          tabIndex={-1}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleSetTag(tag);
                          }}
                          className="text-[9px] bg-muted px-1 py-0.5 rounded hover:bg-primary/10 hover:text-primary cursor-pointer"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </button>
              ) : (
                <button
                  key={item.key}
                  onClick={() => {
                    handleSelectCommand(item.result);
                  }}
                  className={cn(
                    "flex items-start gap-3 w-full px-3 py-2.5 text-left transition-colors",
                    index === selectedIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                >
                  <Puzzle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium truncate">{item.result.title}</div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      Open plugin view from {item.result.pluginName}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className="text-[10px] text-muted-foreground/50">{item.result.id}</span>
                    </div>
                  </div>
                </button>
              )
            )}
          </div>
        )}

        {!isCommandMode && !tagFilter && allTags.length > 0 && (
          <div className="flex items-center gap-1 px-3 py-1.5 border-t border-border">
            <Tag className="h-3 w-3 text-muted-foreground/50" />
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => handleSetTag(tag)}
                className="text-[10px] bg-muted px-1.5 py-0.5 rounded hover:bg-primary/10 hover:text-primary transition-colors"
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {query && !loading && items.length === 0 && !isCommandMode && (
          <div className="px-4 py-6 text-center text-[13px] text-muted-foreground space-y-3">
            <p>No results found</p>
            {!aiSearching && !aiResult && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={async () => {
                  setAiSearching(true);
                  try {
                    const res = await fetch("/api/agents/headless", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        prompt: `Search the configured Obsidian vault for content related to: \"${query}\". List any relevant pages, sections, or information you find. Be concise.`,
                      }),
                    });
                    if (res.ok) {
                      const data = await res.json();
                      setAiResult(data.output || "No relevant content found.");
                    }
                  } catch {
                    setAiResult("AI search failed.");
                  } finally {
                    setAiSearching(false);
                  }
                }}
              >
                <Sparkles className="h-3 w-3" />
                Ask AI
              </Button>
            )}
            {aiSearching && (
              <div className="flex items-center justify-center gap-2 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" />
                Searching with AI...
              </div>
            )}
            {aiResult && (
              <div className="text-left bg-muted/50 rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                {aiResult}
              </div>
            )}
          </div>
        )}

        {isCommandMode && !items.length && (
          <div className="px-4 py-6 text-center text-[13px] text-muted-foreground">
            No plugin commands found.
          </div>
        )}

        <div className="flex items-center justify-between px-3 py-2 border-t border-border text-[10px] text-muted-foreground/50">
          <span>{isCommandMode ? "Type > to filter plugin commands" : "Navigate with arrow keys"}</span>
          <span>Enter to select</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
