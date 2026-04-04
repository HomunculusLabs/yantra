"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCircle,
  Copy,
  Loader2,
  MessageSquare,
  Plus,
  Send,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WebTerminal } from "@/components/terminal/web-terminal";
import { createDaemonSession } from "@/lib/api/agents-client";
import { cn } from "@/lib/utils";
import type { AgentDetailPersona, AgentHeartbeatRecord } from "@/types/agent-api";

type LiveSession = {
  id: string;
  userMessage: string;
  tmuxSessionName?: string | null;
  tmuxAttachCommand?: string | null;
};

type SessionsTabProps = {
  persona: AgentDetailPersona;
  history: AgentHeartbeatRecord[];
  onRefresh: () => Promise<void> | void;
};

export function SessionsTab({ persona, history, onRefresh }: SessionsTabProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [prompt, setPrompt] = useState("");
  const [startingSession, setStartingSession] = useState(false);
  const [copiedTmux, setCopiedTmux] = useState(false);
  const [liveSession, setLiveSession] = useState<LiveSession | null>(null);

  const copyTimeoutRef = useRef<number | null>(null);

  const selectedSession = selectedIndex !== null ? history[selectedIndex] : null;

  const handleSendPrompt = async () => {
    if (!prompt.trim()) return;

    const userMessage = prompt.trim();
    const sessionId = `agent-${persona.slug}-${Date.now()}`;
    const fullPrompt = `${persona.body}\n\n---\n\nUser request: ${userMessage}`;

    setStartingSession(true);
    try {
      const data = await createDaemonSession({
        sessionId,
        agentSlug: persona.slug,
        prompt: fullPrompt,
      });
      setLiveSession({
        id: data.sessionId || sessionId,
        userMessage,
        tmuxSessionName: data.tmuxSessionName,
        tmuxAttachCommand: data.tmuxAttachCommand,
      });
      setCopiedTmux(false);
      setSelectedIndex(null);
      setPrompt("");
    } catch {
      // Preserve the current silent-failure behavior.
    } finally {
      setStartingSession(false);
    }
  };

  const handleSessionEnd = () => {
    setLiveSession(null);
    void onRefresh();
  };

  const handleNewSession = () => {
    setSelectedIndex(null);
    setLiveSession(null);
    setCopiedTmux(false);
  };

  const handleCopyTmuxCommand = async () => {
    if (!liveSession?.tmuxAttachCommand) return;

    try {
      await navigator.clipboard.writeText(liveSession.tmuxAttachCommand);
      setCopiedTmux(true);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => setCopiedTmux(false), 2000);
    } catch {
      // ignore clipboard failures
    }
  };

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const showNewPrompt = !liveSession && selectedIndex === null;

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex min-w-[240px] w-[240px] flex-col border-r border-border bg-muted/5">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            History
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={handleNewSession}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-0.5 p-1.5">
            {(liveSession || startingSession) && (
              <button className="flex w-full items-start gap-2 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-2 text-left text-[11px]">
                <div className="mt-0.5 shrink-0">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-medium leading-tight text-foreground">
                    {liveSession?.userMessage || prompt}
                  </p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                    {startingSession ? "starting..." : "running..."}
                  </p>
                </div>
              </button>
            )}

            {history.length === 0 && !liveSession && (
              <p className="px-2 py-6 text-center text-[11px] text-muted-foreground/50">
                No sessions yet
              </p>
            )}

            {history.map((heartbeat, index) => {
              const date = new Date(heartbeat.timestamp);
              const summaryLine =
                heartbeat.summary
                  ?.replace(/^---\s*\n/, "")
                  ?.replace(/^#+\s*/, "")
                  ?.split("\n")[0]
                  ?.trim() || "Session";

              return (
                <button
                  key={index}
                  onClick={() => {
                    setSelectedIndex(index);
                    setLiveSession(null);
                  }}
                  className={cn(
                    "group flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-[11px] transition-colors",
                    selectedIndex === index
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    {heartbeat.status === "completed" ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-red-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium leading-tight">
                      {summaryLine.length > 50
                        ? `${summaryLine.slice(0, 50)}...`
                        : summaryLine}
                    </p>
                    <p className="mt-0.5 text-[10px] text-muted-foreground/60">
                      {date.toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      {date.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      <span className="ml-1.5">
                        {Math.round(heartbeat.duration / 1000)}s
                      </span>
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        {liveSession ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium">
                    {liveSession.userMessage}
                  </div>
                  {liveSession.tmuxSessionName ? (
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      {liveSession.tmuxSessionName}
                    </div>
                  ) : null}
                </div>
              </div>
              {liveSession.tmuxAttachCommand ? (
                <Button
                  variant="outline"
                  size="xs"
                  className="shrink-0"
                  onClick={() => void handleCopyTmuxCommand()}
                  title={liveSession.tmuxAttachCommand}
                >
                  {copiedTmux ? (
                    <>
                      <Check className="h-3 w-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      tmux
                    </>
                  )}
                </Button>
              ) : null}
            </div>
            <div className="min-h-0 flex-1">
              <WebTerminal sessionId={liveSession.id} onClose={handleSessionEnd} />
            </div>
          </div>
        ) : selectedSession ? (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              {selectedSession.status === "completed" ? (
                <CheckCircle className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500" />
              )}
              <span className="text-[12px] font-medium capitalize">
                {selectedSession.status}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {Math.round(selectedSession.duration / 1000)}s
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {new Date(selectedSession.timestamp).toLocaleString([], {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4">
                <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-foreground/90">
                  {selectedSession.summary ||
                    "No output captured for this session."}
                </pre>
              </div>
            </ScrollArea>
            <div className="border-t border-border p-3">
              <div className="flex gap-2">
                <input
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSendPrompt();
                    }
                  }}
                  placeholder={`Ask ${persona.name} something...`}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <Button
                  size="sm"
                  className="h-8 gap-1"
                  onClick={() => void handleSendPrompt()}
                  disabled={!prompt.trim()}
                >
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        ) : showNewPrompt ? (
          <div className="flex flex-1 flex-col items-center justify-center px-8">
            <div className="mb-6 text-center">
              <MessageSquare className="mx-auto mb-3 h-10 w-10 text-muted-foreground/20" />
              <h3 className="text-[14px] font-medium text-foreground/80">
                New Session
              </h3>
              <p className="mt-1 max-w-sm text-[12px] text-muted-foreground">
                Send a prompt to {persona.name} to start a live launcher-backed
                session.
              </p>
            </div>
            <div className="w-full max-w-lg">
              <div className="flex gap-2">
                <input
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void handleSendPrompt();
                    }
                  }}
                  placeholder={`Ask ${persona.name} something...`}
                  className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                  autoFocus
                />
                <Button
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={() => void handleSendPrompt()}
                  disabled={!prompt.trim() || startingSession}
                >
                  <Send className="h-3.5 w-3.5" />
                  {startingSession ? "Starting..." : "Send"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
