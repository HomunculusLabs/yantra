"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  X,
  Send,
  Sparkles,
  FileText,
  Trash2,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { useEditorStore } from "@/stores/editor-store";
import { useAppStore } from "@/stores/app-store";
import { WebTerminal } from "@/components/terminal/web-terminal";
import type { TreeNode } from "@/types";

interface FlatPage {
  path: string;
  title: string;
}

function flattenTree(nodes: TreeNode[]): FlatPage[] {
  const result: FlatPage[] = [];
  for (const node of nodes) {
    if (node.type !== "website") {
      result.push({
        path: node.path,
        title: node.frontmatter?.title || node.name,
      });
    }
    if (node.children) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

interface PastSession {
  id: string;
  pagePath: string;
  instruction: string;
  timestamp: string;
  duration: number;
  status: "completed" | "failed";
  summary: string;
}

export function EditorAIPanel() {
  const {
    close,
    editorSessions,
    addEditorSession,
    markSessionCompleted,
    removeSession,
    clearAllSessions,
  } = useAIPanelStore();
  const { currentPath, loadPage } = useEditorStore();
  const [input, setInput] = useState("");
  const [mentionedPages, setMentionedPages] = useState<string[]>([]);
  const [pastSessions, setPastSessions] = useState<PastSession[]>([]);
  const [expandedPast, setExpandedPast] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const savedSessionsRef = useRef<Set<string>>(new Set());

  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [allPages, setAllPages] = useState<FlatPage[]>([]);
  const [mentionStartPos, setMentionStartPos] = useState(0);

  const currentPageSessions = editorSessions.filter(
    (session) => session.pagePath === currentPath
  );
  const otherPageRunningSessions = editorSessions.filter(
    (session) => session.pagePath !== currentPath && session.status === "running"
  );

  useEffect(() => {
    const restore = async () => {
      useAIPanelStore.getState().restoreSessionsFromStorage();

      try {
        const res = await fetch("/api/daemon/sessions");
        if (res.ok) {
          const serverSessions: { id: string; exited: boolean }[] = await res.json();
          const aliveIds = new Set(serverSessions.filter((s) => !s.exited).map((s) => s.id));
          const exitedIds = new Set(serverSessions.filter((s) => s.exited).map((s) => s.id));

          const state = useAIPanelStore.getState();
          for (const session of state.editorSessions) {
            if (session.status === "running" && session.reconnect) {
              if (exitedIds.has(session.sessionId)) {
                state.markSessionCompleted(session.sessionId);
              } else if (!aliveIds.has(session.sessionId)) {
                state.removeSession(session.sessionId);
              }
            }
          }
        }
      } catch {
        const state = useAIPanelStore.getState();
        for (const session of state.editorSessions) {
          if (session.reconnect) {
            state.removeSession(session.sessionId);
          }
        }
      }
    };
    void restore();
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/tree");
        if (res.ok) {
          const tree = await res.json();
          setAllPages(flattenTree(tree));
        }
      } catch {
        // ignore
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!currentPath) return;
    const loadPast = async () => {
      try {
        const res = await fetch(
          `/api/agents/editor-sessions?page=${encodeURIComponent(currentPath)}&limit=20`
        );
        if (res.ok) {
          const data = await res.json();
          setPastSessions(data);
        }
      } catch {
        // ignore
      }
    };
    void loadPast();
  }, [currentPath]);

  const filteredPages = allPages.filter(
    (page) =>
      page.title.toLowerCase().includes(mentionQuery.toLowerCase()) ||
      page.path.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [currentPageSessions.length]);

  useEffect(() => {
    window.setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  const insertMention = useCallback(
    (page: FlatPage) => {
      const before = input.slice(0, mentionStartPos);
      const after = input.slice(inputRef.current?.selectionStart || input.length);
      const nextInput = `${before}@${page.title} ${after}`;
      setInput(nextInput);
      setMentionedPages((prev) =>
        prev.includes(page.path) ? prev : [...prev, page.path]
      );
      setShowMentions(false);
      setMentionQuery("");
      window.setTimeout(() => {
        if (!inputRef.current) return;
        const pos = before.length + page.title.length + 2;
        inputRef.current.selectionStart = pos;
        inputRef.current.selectionEnd = pos;
        inputRef.current.focus();
      }, 0);
    },
    [input, mentionStartPos]
  );

  const handleInputChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    const position = event.target.selectionStart || 0;
    setInput(value);

    const textBefore = value.slice(0, position);
    const atIndex = textBefore.lastIndexOf("@");
    if (atIndex !== -1) {
      const charBeforeAt = atIndex > 0 ? textBefore[atIndex - 1] : " ";
      if (charBeforeAt === " " || charBeforeAt === "\n" || atIndex === 0) {
        const query = textBefore.slice(atIndex + 1);
        if (!query.includes(" ") && !query.includes("\n")) {
          setShowMentions(true);
          setMentionQuery(query);
          setMentionIndex(0);
          setMentionStartPos(atIndex);
          return;
        }
      }
    }

    setShowMentions(false);
  };

  const handleSubmit = async () => {
    if (!input.trim() || !currentPath) return;

    const instruction = input.trim();
    setInput("");
    const selectedMentionedPages = mentionedPages;
    setMentionedPages([]);

    try {
      const response = await fetch("/api/agents/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "editor",
          pagePath: currentPath,
          userMessage: instruction,
          mentionedPaths: selectedMentionedPages,
        }),
      });

      if (!response.ok) {
        setInput(instruction);
        setMentionedPages(selectedMentionedPages);
        return;
      }

      const data = await response.json();
      const conversation = data.conversation as {
        id: string;
        title: string;
        startedAt?: string;
      };
      addEditorSession({
        id: conversation.id,
        sessionId: conversation.id,
        pagePath: currentPath,
        userMessage: instruction,
        prompt: conversation.title,
        timestamp: conversation.startedAt
          ? new Date(conversation.startedAt).getTime()
          : 0,
        status: "running",
        reconnect: true,
      });
    } catch {
      setInput(instruction);
      setMentionedPages(selectedMentionedPages);
      return;
    }

    window.setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 100);
  };

  const persistSession = useCallback(async (sessionId: string) => {
    if (savedSessionsRef.current.has(sessionId)) return;
    savedSessionsRef.current.add(sessionId);

    const session = useAIPanelStore
      .getState()
      .editorSessions.find((entry) => entry.sessionId === sessionId);
    if (!session) return;

    let summary = "";
    try {
      const res = await fetch(`/api/daemon/session/${sessionId}/output`);
      if (res.ok) {
        const data = await res.json();
        summary = data.output || "";
      }
    } catch {
      // ignore
    }

    const duration = Math.round((Date.now() - session.timestamp) / 1000);

    try {
      await fetch("/api/agents/editor-sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sessionId,
          pagePath: session.pagePath,
          instruction: session.userMessage,
          timestamp: new Date(session.timestamp).toISOString(),
          duration,
          status: "completed",
          summary: summary.slice(0, 500),
          output: summary,
        }),
      });
    } catch {
      // ignore
    }
  }, []);

  const handleSessionEnd = useCallback(
    async (sessionId: string) => {
      markSessionCompleted(sessionId);
      await persistSession(sessionId);

      const session = useAIPanelStore
        .getState()
        .editorSessions.find((entry) => entry.sessionId === sessionId);
      const currentPagePath = useEditorStore.getState().currentPath;
      if (session && currentPagePath === session.pagePath) {
        window.setTimeout(() => {
          void loadPage(session.pagePath);
        }, 500);
      }
    },
    [loadPage, markSessionCompleted, persistSession]
  );

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (showMentions && filteredPages.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((index) => Math.min(index + 1, filteredPages.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const page = filteredPages[mentionIndex];
        if (page) insertMention(page);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setShowMentions(false);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const togglePastExpanded = (id: string) => {
    setExpandedPast((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const formatTime = (timestamp: string | number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const formatDate = (timestamp: string | number) => {
    const date = new Date(timestamp);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) return "Today";
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const hasAnySessions =
    currentPageSessions.length > 0 ||
    pastSessions.length > 0 ||
    otherPageRunningSessions.length > 0;

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-[13px] font-semibold tracking-[-0.02em]">
            AI Editor
          </span>
          {currentPath ? (
            <span className="text-[11px] text-muted-foreground">
              {currentPath.split("/").pop()}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {hasAnySessions ? (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              title="Clear all sessions"
              onClick={() => {
                clearAllSessions();
                setPastSessions([]);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          <Button variant="ghost" size="icon-sm" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "flex-1 min-h-0 flex flex-col",
          currentPageSessions.length === 0 && "overflow-y-auto"
        )}
        ref={scrollRef}
      >
        <div
          className={cn(
            "p-3 flex flex-col gap-3",
            currentPageSessions.length > 0 && "flex-1"
          )}
        >
          {!hasAnySessions ? (
            <div className="py-8 text-center">
              <div className="mx-auto flex max-w-xs flex-col items-center gap-2">
                <Sparkles className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-[13px] text-muted-foreground">
                  Tell me how you&apos;d like to edit this page.
                </p>
                <p className="text-xs text-muted-foreground/60">
                  Use <span className="rounded bg-muted px-1 font-mono">@</span> to
                  reference other pages as context.
                </p>
                <p className="text-xs text-muted-foreground/60">
                  Sessions persist across pages and show in the editor rail.
                </p>
              </div>
            </div>
          ) : null}

          {otherPageRunningSessions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <div className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Running on other pages
              </div>
              {otherPageRunningSessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => {
                    useAppStore.getState().setSection({ type: "page" });
                    void loadPage(session.pagePath);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg border border-border/50 bg-card/40 px-3 py-2 text-left text-[12px] transition-colors hover:bg-accent/30"
                >
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                  <span className="flex-1 truncate text-muted-foreground">
                    {session.userMessage}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/50">
                    {session.pagePath.split("/").pop()}
                  </span>
                  <span
                    role="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeSession(session.sessionId);
                    }}
                    className="shrink-0 text-muted-foreground/40 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          {pastSessions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <div className="px-1 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Previous Sessions
              </div>
              {pastSessions.map((session) => (
                <div
                  key={session.id}
                  className="overflow-hidden rounded-lg border border-border/50 bg-card/40"
                >
                  <button
                    onClick={() => togglePastExpanded(session.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-accent/30"
                  >
                    {expandedPast.has(session.id) ? (
                      <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    )}
                    <CheckCircle className="h-3 w-3 shrink-0 text-green-500" />
                    <span className="flex-1 truncate text-[12px]">
                      {session.instruction}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground/60">
                      {formatDate(session.timestamp)} {formatTime(session.timestamp)}
                    </span>
                  </button>
                  {expandedPast.has(session.id) ? (
                    <div className="border-t border-border/50 bg-muted/35">
                      <pre className="max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                        {session.summary || "(No output captured)"}
                      </pre>
                      <div className="flex items-center gap-3 border-t border-border/50 px-3 py-1.5 text-[10px] text-muted-foreground/50">
                        <span>
                          <Clock className="mr-1 inline h-2.5 w-2.5" />
                          {session.duration}s
                        </span>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {pastSessions.length > 0 && currentPageSessions.length > 0 ? (
            <div className="px-1 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
              Current Sessions
            </div>
          ) : null}

          {currentPageSessions.map((session, index) => (
            <div
              key={session.id}
              className={cn(
                "flex flex-col gap-2",
                index === currentPageSessions.length - 1 && "flex-1 min-h-0"
              )}
            >
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex-1 rounded-lg bg-accent/50 px-3 py-2 text-[13px] leading-relaxed">
                  {session.userMessage}
                </div>
                <button
                  onClick={() => {
                    void persistSession(session.sessionId);
                    removeSession(session.sessionId);
                  }}
                  className="shrink-0 p-1 text-muted-foreground/40 hover:text-destructive"
                  title="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="min-h-[200px] flex-1 overflow-hidden rounded-lg border border-border/60 bg-card/50">
                <WebTerminal
                  sessionId={session.sessionId}
                  prompt={session.prompt}
                  displayPrompt={session.userMessage}
                  reconnect={session.reconnect}
                  onClose={() => void handleSessionEnd(session.sessionId)}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {editorSessions
        .filter((session) => session.pagePath !== currentPath && session.status === "running")
        .map((session) => (
          <div
            key={`hidden-${session.id}`}
            style={{ width: 0, height: 0, overflow: "hidden", position: "absolute" }}
          >
            <WebTerminal
              sessionId={session.sessionId}
              prompt={session.prompt}
              displayPrompt={session.userMessage}
              reconnect={session.reconnect}
              onClose={() => void handleSessionEnd(session.sessionId)}
            />
          </div>
        ))}

      <div className="border-t border-border p-3 shrink-0">
        {mentionedPages.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-1">
            {mentionedPages.map((pagePath) => {
              const page = allPages.find((entry) => entry.path === pagePath);
              return (
                <span
                  key={pagePath}
                  className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                >
                  <FileText className="h-2.5 w-2.5" />
                  {page?.title || pagePath}
                  <button
                    onClick={() =>
                      setMentionedPages((prev) => prev.filter((entry) => entry !== pagePath))
                    }
                    className="ml-0.5 hover:text-destructive"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        ) : null}

        <div className="relative">
          {showMentions && filteredPages.length > 0 ? (
            <div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-[200px] overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-lg">
              {filteredPages.slice(0, 10).map((page, index) => (
                <button
                  key={page.path}
                  onClick={() => insertMention(page)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
                    index === mentionIndex
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50"
                  )}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">{page.title}</p>
                    <p className="truncate text-[10px] text-muted-foreground/60">
                      {page.path}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={
              currentPath
                ? "Ask anything... use @ to reference pages"
                : "Select a page first..."
            }
            disabled={!currentPath}
            rows={2}
            className={cn(
              "w-full resize-none rounded-lg border border-border bg-muted/30 px-3 py-2.5 pr-10",
              "text-[13px] leading-relaxed placeholder:text-muted-foreground/50",
              "focus:outline-none focus:ring-1 focus:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50"
            )}
          />
          <div className="absolute bottom-1.5 right-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Send"
              onClick={() => void handleSubmit()}
              disabled={!input.trim() || !currentPath}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
