"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  History,
  Loader2,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAIPanelStore } from "@/stores/ai-panel-store";

type TaskFilterState = "all" | "succeeded" | "failed" | "cancelled" | "skipped";
type TaskSourceFilter = "all" | "manual" | "scheduler";

type RecentTask = {
  taskId: string;
  runId: string | null;
  taskName: string;
  taskState: string;
  runState: string | null;
  attempt: number | null;
  agentSlug: string | null;
  jobId: string | null;
  source: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  resultStatus: string | null;
  conversationId: string | null;
  summary: string | null;
  reason: string | null;
  exitCode: number | null;
  error: string | null;
  title: string;
  conversationStatus: string | null;
  terminalStatus: TaskFilterState;
};

const STATUS_FILTERS: Array<{ value: TaskFilterState; label: string }> = [
  { value: "all", label: "All" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "skipped", label: "Skipped" },
];

const SOURCE_FILTERS: Array<{ value: TaskSourceFilter; label: string }> = [
  { value: "all", label: "Any source" },
  { value: "manual", label: "Manual" },
  { value: "scheduler", label: "Scheduler" },
];

function formatRelativeTime(timestamp: string | null): string {
  if (!timestamp) return "just now";

  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return `${Math.floor(diffHours / 24)}d ago`;
}

function getTaskIcon(task: RecentTask) {
  if (task.terminalStatus === "failed") {
    return <XCircle className="h-4 w-4 text-destructive" />;
  }
  if (task.terminalStatus === "cancelled") {
    return <Ban className="h-4 w-4 text-muted-foreground" />;
  }
  if (task.terminalStatus === "skipped") {
    return <CheckCircle2 className="h-4 w-4 text-amber-500" />;
  }
  return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
}

function getStatusBadgeClass(status: TaskFilterState) {
  switch (status) {
    case "failed":
      return "bg-destructive/10 text-destructive";
    case "cancelled":
      return "bg-muted text-muted-foreground";
    case "skipped":
      return "bg-amber-500/10 text-amber-600";
    default:
      return "bg-emerald-500/10 text-emerald-600";
  }
}

function getStatusLabel(task: RecentTask) {
  if (task.terminalStatus === "failed") return "Failed";
  if (task.terminalStatus === "cancelled") return "Cancelled";
  if (task.terminalStatus === "skipped") return "Skipped";
  return "Completed";
}

export function TasksPanel() {
  const close = useAIPanelStore((state) => state.close);
  const openAgentPanel = useAIPanelStore((state) => state.openAgentPanel);

  const [tasks, setTasks] = useState<RecentTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TaskFilterState>("all");
  const [sourceFilter, setSourceFilter] = useState<TaskSourceFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(searchInput.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  const loadTasks = useCallback(
    async (background = false) => {
      if (background) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      try {
        const params = new URLSearchParams({ limit: "30" });
        if (statusFilter !== "all") params.set("state", statusFilter);
        if (sourceFilter !== "all") params.set("source", sourceFilter);
        if (query) params.set("query", query);

        const response = await fetch(`/api/agents/recent-tasks?${params.toString()}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to load recent tasks");
        }

        setTasks((data.tasks || []) as RecentTask[]);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load recent tasks");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [query, sourceFilter, statusFilter]
  );

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadTasks(true);
    }, 5000);

    const onFocus = () => {
      void loadTasks(true);
    };

    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadTasks]);

  const hasFilters = statusFilter !== "all" || sourceFilter !== "all" || query.length > 0;

  const resultLabel = useMemo(() => {
    if (isLoading) return "Loading tasks…";
    if (tasks.length === 1) return "1 task";
    return `${tasks.length} tasks`;
  }, [isLoading, tasks.length]);

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
        <div className="flex min-w-0 items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-[-0.02em]">
              Recent Tasks
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              Durable job runs from Absurd · {resultLabel}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void loadTasks(true)}
            title="Refresh recent tasks"
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="border-b border-border p-3 shrink-0">
        <div className="space-y-3">
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search jobs, agents, summaries..."
          />

          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Status
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((filter) => (
                <Button
                  key={filter.value}
                  variant={statusFilter === filter.value ? "default" : "outline"}
                  size="sm"
                  className="h-7 rounded-full px-3 text-[11px]"
                  onClick={() => setStatusFilter(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Source
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_FILTERS.map((filter) => (
                <Button
                  key={filter.value}
                  variant={sourceFilter === filter.value ? "default" : "outline"}
                  size="sm"
                  className="h-7 rounded-full px-3 text-[11px]"
                  onClick={() => setSourceFilter(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          </div>

          {hasFilters ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/50 px-3 py-2 text-[11px] text-muted-foreground">
              <span>Showing filtered results</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => {
                  setStatusFilter("all");
                  setSourceFilter("all");
                  setSearchInput("");
                  setQuery("");
                }}
              >
                Clear
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2 p-3">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card/50 px-3 py-4 text-[12px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading recent tasks...
            </div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-4 text-[12px] text-destructive">
              {error}
            </div>
          ) : tasks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 px-4 py-8 text-center">
              <p className="text-[13px] font-medium">No matching tasks</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Adjust the filters or wait for the next completed job run.
              </p>
            </div>
          ) : (
            tasks.map((task) => (
              <button
                key={task.taskId}
                onClick={() => openAgentPanel(task.agentSlug || null, task.conversationId || null)}
                className="w-full rounded-xl border border-border bg-card/60 px-3 py-3 text-left transition-colors hover:bg-accent/40"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">{getTaskIcon(task)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium text-foreground">
                          {task.title}
                        </p>
                        <p className="mt-1 truncate text-[11px] text-muted-foreground">
                          {task.agentSlug || "agent"} · {task.source || "manual"} · {formatRelativeTime(task.finishedAt)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          getStatusBadgeClass(task.terminalStatus)
                        )}
                      >
                        {getStatusLabel(task)}
                      </span>
                    </div>

                    {task.summary ? (
                      <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground/80">
                        {task.summary}
                      </p>
                    ) : null}

                    <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground/70">
                      {task.jobId ? <span className="truncate">job:{task.jobId}</span> : null}
                      {task.attempt ? <span>attempt {task.attempt}</span> : null}
                      {typeof task.exitCode === "number" ? <span>exit {task.exitCode}</span> : null}
                      {task.conversationId ? <span>conversation linked</span> : null}
                      <ChevronRight className="ml-auto h-3 w-3 shrink-0" />
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </>
  );
}
