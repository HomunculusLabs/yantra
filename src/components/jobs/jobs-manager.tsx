"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Clock,
  Plus,
  Trash2,
  RefreshCw,
  Zap,
  CheckCircle,
  XCircle,
  Pencil,
  ChevronDown,
  ChevronRight,
  Play,
  Pause,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SchedulePicker } from "@/components/mission-control/schedule-picker";
import { cronToHuman } from "@/lib/agents/cron-utils";
import type { JobTaskStatus } from "@/types/jobs";

interface JobConfig {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  prompt: string;
  timeout?: number;
  agentSlug: string;
  execution?: {
    launcherId?: string;
    cwd?: string;
    inheritAgent?: boolean;
  };
  createdAt?: string;
  updatedAt?: string;
  latestTask?: JobTaskStatus | null;
}

interface AgentWithJobs {
  slug: string;
  name: string;
  emoji: string;
  jobs: JobConfig[];
}

function formatTaskStatus(task?: JobTaskStatus | null): {
  label: string;
  tone: string;
  Icon: typeof Clock;
} | null {
  if (!task) return null;

  if (task.state === "pending") {
    return { label: "Queued", tone: "text-amber-500", Icon: Clock };
  }
  if (task.state === "running" || task.state === "sleeping") {
    return { label: task.state === "sleeping" ? "Sleeping" : "Running", tone: "text-blue-500", Icon: RefreshCw };
  }
  if (task.state === "cancelled") {
    return { label: "Cancelled", tone: "text-muted-foreground", Icon: Pause };
  }
  if (task.state === "failed") {
    return { label: "Task failed", tone: "text-red-500", Icon: XCircle };
  }
  if (task.outcome === "failed") {
    return { label: "Run failed", tone: "text-red-500", Icon: XCircle };
  }
  if (task.outcome === "skipped") {
    return { label: "Skipped", tone: "text-muted-foreground", Icon: Pause };
  }

  return { label: "Completed", tone: "text-green-600", Icon: CheckCircle };
}

export function JobsManager() {
  const [agents, setAgents] = useState<AgentWithJobs[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [createAgentSlug, setCreateAgentSlug] = useState<string>("");
  const [editJob, setEditJob] = useState<JobConfig | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    schedule: "0 9 * * *",
    prompt: "",
    timeout: 600,
    executionLauncherId: "",
    executionCwd: "",
  });
  const [running, setRunning] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/personas");
      if (!res.ok) return;
      const { personas } = await res.json();

      const withJobs = await Promise.all(
        (personas as { slug: string; name: string; emoji: string }[]).map(async (p) => {
          const jRes = await fetch(`/api/agents/${p.slug}/jobs`);
          const jobs = jRes.ok ? (await jRes.json()).jobs || [] : [];
          return { slug: p.slug, name: p.name, emoji: p.emoji || "🤖", jobs };
        })
      );
      setAgents(withJobs);
      // Auto-expand agents that have jobs
      setExpanded((prev) => {
        const next = new Set(prev);
        withJobs.filter((a) => a.jobs.length > 0).forEach((a) => next.add(a.slug));
        return next;
      });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const toggleExpand = (slug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  };

  const openCreate = (slug: string) => {
    setCreateAgentSlug(slug);
    setForm({
      name: "",
      schedule: "0 9 * * *",
      prompt: "",
      timeout: 600,
      executionLauncherId: "",
      executionCwd: "",
    });
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!form.name || !form.prompt) return;
    await fetch(`/api/agents/${createAgentSlug}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        schedule: form.schedule,
        prompt: form.prompt,
        timeout: form.timeout,
        execution:
          form.executionLauncherId || form.executionCwd
            ? {
                inheritAgent: !form.executionLauncherId,
                launcherId: form.executionLauncherId || undefined,
                cwd: form.executionCwd || undefined,
              }
            : undefined,
      }),
    });
    setCreateOpen(false);
    refresh();
  };

  const openEdit = (job: JobConfig) => {
    setEditJob(job);
    setForm({
      name: job.name,
      schedule: job.schedule,
      prompt: job.prompt,
      timeout: job.timeout || 600,
      executionLauncherId: job.execution?.launcherId || "",
      executionCwd: job.execution?.cwd || "",
    });
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!editJob) return;
    await fetch(`/api/agents/${editJob.agentSlug}/jobs/${editJob.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        schedule: form.schedule,
        prompt: form.prompt,
        timeout: form.timeout,
        execution:
          form.executionLauncherId || form.executionCwd
            ? {
                inheritAgent: !form.executionLauncherId,
                launcherId: form.executionLauncherId || undefined,
                cwd: form.executionCwd || undefined,
              }
            : undefined,
      }),
    });
    setEditOpen(false);
    setEditJob(null);
    refresh();
  };

  const handleDelete = async (job: JobConfig) => {
    if (!confirm(`Delete job "${job.name}"?`)) return;
    await fetch(`/api/agents/${job.agentSlug}/jobs/${job.id}`, { method: "DELETE" });
    refresh();
  };

  const handleToggle = async (job: JobConfig) => {
    await fetch(`/api/agents/${job.agentSlug}/jobs/${job.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle" }),
    });
    refresh();
  };

  const handleRunNow = async (job: JobConfig) => {
    setRunning(job.id);
    await fetch(`/api/agents/${job.agentSlug}/jobs/${job.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    });
    setRunning(null);
    refresh();
  };

  const totalJobs = agents.reduce((sum, a) => sum + a.jobs.length, 0);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h2 className="text-[15px] font-semibold tracking-[-0.02em]">Jobs</h2>
          <span className="text-[11px] text-muted-foreground">{totalJobs} total</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Agent + Jobs list */}
      <div className="flex-1 overflow-y-auto">
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
            <Zap className="h-8 w-8 opacity-30" />
            <p className="text-[13px]">No agents found</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {agents.map((agent) => (
              <div key={agent.slug}>
                {/* Agent row */}
                <button
                  onClick={() => toggleExpand(agent.slug)}
                  className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-accent/30 transition-colors text-left"
                >
                  {expanded.has(agent.slug) ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className="text-base">{agent.emoji}</span>
                  <span className="text-[13px] font-medium flex-1">{agent.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {agent.jobs.length} {agent.jobs.length === 1 ? "job" : "jobs"}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); openCreate(agent.slug); }}
                    className="ml-1 p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                    title="Add job"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </button>

                {/* Jobs for this agent */}
                {expanded.has(agent.slug) && (
                  <div className="bg-muted/20">
                    {agent.jobs.length === 0 ? (
                      <div className="px-10 py-3 text-[12px] text-muted-foreground/60">
                        No jobs yet —{" "}
                        <button
                          onClick={() => openCreate(agent.slug)}
                          className="underline hover:text-foreground"
                        >
                          add one
                        </button>
                      </div>
                    ) : (
                      agent.jobs.map((job) => (
                        <div
                          key={job.id}
                          className="flex items-start gap-3 px-10 py-2.5 border-t border-border/50"
                        >
                          <div className="flex-1 min-w-0">
                            {(() => {
                              const taskStatus = formatTaskStatus(job.latestTask);
                              return (
                                <>
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "w-1.5 h-1.5 rounded-full shrink-0",
                                job.enabled ? "bg-green-500" : "bg-muted-foreground/30"
                              )} />
                              <span className="text-[13px] font-medium truncate">{job.name}</span>
                              {taskStatus && (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]",
                                    taskStatus.tone
                                  )}
                                >
                                  <taskStatus.Icon
                                    className={cn(
                                      "h-3 w-3",
                                      taskStatus.Icon === RefreshCw && "animate-spin"
                                    )}
                                  />
                                  {taskStatus.label}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="text-[11px] text-muted-foreground">
                                {cronToHuman(job.schedule)}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                              {job.prompt.slice(0, 80)}{job.prompt.length > 80 ? "…" : ""}
                            </p>
                            {job.latestTask && (
                              <p className="text-[10px] text-muted-foreground/70 truncate mt-1">
                                {job.latestTask.summary ||
                                  job.latestTask.reason ||
                                  job.latestTask.error ||
                                  `Task ${job.latestTask.taskID.slice(0, 8)}`}
                              </p>
                            )}
                                </>
                              );
                            })()}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleRunNow(job)}
                              disabled={running === job.id}
                              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary"
                              title="Run now"
                            >
                              <Zap className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => handleToggle(job)}
                              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                              title={job.enabled ? "Pause" : "Enable"}
                            >
                              {job.enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                            </button>
                            <button
                              onClick={() => openEdit(job)}
                              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                              title="Edit"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => handleDelete(job)}
                              className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-destructive"
                              title="Delete"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Job Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Job</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Daily report"
                className="mt-1 h-8 text-[13px]"
              />
            </div>
            <SchedulePicker
              label="Schedule"
              value={form.schedule}
              onChange={(schedule) => setForm((f) => ({ ...f, schedule }))}
            />
            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Prompt</label>
              <textarea
                value={form.prompt}
                onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                placeholder="What should this job do each run?"
                rows={4}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Launcher ID</label>
              <Input
                value={form.executionLauncherId}
                onChange={(e) => setForm((f) => ({ ...f, executionLauncherId: e.target.value }))}
                placeholder="inherit agent launcher"
                className="mt-1 h-8 text-[13px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Working Directory</label>
              <Input
                value={form.executionCwd}
                onChange={(e) => setForm((f) => ({ ...f, executionCwd: e.target.value }))}
                placeholder="relative to configured vault"
                className="mt-1 h-8 text-[13px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreate} disabled={!form.name || !form.prompt}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Job Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Job</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="mt-1 h-8 text-[13px]"
              />
            </div>
            <SchedulePicker
              label="Schedule"
              value={form.schedule}
              onChange={(schedule) => setForm((f) => ({ ...f, schedule }))}
            />
            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wide">Prompt</label>
              <textarea
                value={form.prompt}
                onChange={(e) => setForm((f) => ({ ...f, prompt: e.target.value }))}
                rows={4}
                className="mt-1 w-full px-3 py-2 text-[13px] rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
