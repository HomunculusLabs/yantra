"use client";

import { useState } from "react";
import { Briefcase, Loader2, Play, Plus, Save, Trash2 } from "lucide-react";
import { LauncherIdSelect } from "@/components/agents/launcher-id-select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type CreateJobPayload, type JobConfig, type UpdateJobPayload } from "@/types/jobs";
import { CronPicker, cronToHuman } from "./cron-picker";
import { useAgentJobs } from "./use-agent-jobs";

type JobsTabProps = {
  slug: string;
};

function buildExecutionConfig(launcherId: string, cwd: string) {
  if (!launcherId && !cwd) {
    return undefined;
  }

  return {
    inheritAgent: !launcherId,
    launcherId: launcherId || undefined,
    cwd: cwd || undefined,
  };
}

export function JobsTab({ slug }: JobsTabProps) {
  const { jobs, loading, runningJobId, createJob, updateJob, toggleJob, runJob, deleteJob } =
    useAgentJobs(slug);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCron, setNewCron] = useState("0 9 * * 1-5");
  const [newPrompt, setNewPrompt] = useState("");
  const [newLauncherId, setNewLauncherId] = useState("");
  const [newCwd, setNewCwd] = useState("");
  const [editingJob, setEditingJob] = useState<string | null>(null);
  const [editCron, setEditCron] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editLauncherId, setEditLauncherId] = useState("");
  const [editCwd, setEditCwd] = useState("");

  const handleAdd = async () => {
    if (!newName.trim() || !newPrompt.trim()) return;

    const payload: CreateJobPayload = {
      name: newName.trim(),
      schedule: newCron,
      prompt: newPrompt.trim(),
      execution: buildExecutionConfig(newLauncherId, newCwd),
    };

    await createJob(payload);
    setAdding(false);
    setNewName("");
    setNewCron("0 9 * * 1-5");
    setNewPrompt("");
    setNewLauncherId("");
    setNewCwd("");
  };

  const handleUpdateJob = async (jobId: string) => {
    const job = jobs.find((entry) => entry.id === jobId);
    if (!job) return;

    const updates: UpdateJobPayload = {};
    if (editCron && editCron !== job.schedule) {
      updates.schedule = editCron;
    }
    if (editPrompt !== job.prompt) {
      updates.prompt = editPrompt;
    }
    if (
      editLauncherId !== (job.execution?.launcherId || "") ||
      editCwd !== (job.execution?.cwd || "")
    ) {
      updates.execution = buildExecutionConfig(editLauncherId, editCwd);
    }

    if (Object.keys(updates).length > 0) {
      await updateJob(jobId, updates);
    }
    setEditingJob(null);
  };

  const startEditingJob = (job: JobConfig) => {
    setEditingJob(editingJob === job.id ? null : job.id);
    setEditCron(job.schedule);
    setEditPrompt(job.prompt);
    setEditLauncherId(job.execution?.launcherId || "");
    setEditCwd(job.execution?.cwd || "");
  };

  if (loading) {
    return <p className="text-[13px] text-muted-foreground">Loading jobs...</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Scheduled Jobs
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-6 gap-1 text-[10px]"
          onClick={() => setAdding(true)}
        >
          <Plus className="h-3 w-3" />
          Add Job
        </Button>
      </div>

      {adding && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-3">
          <input
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Job name..."
            className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
            onKeyDown={(event) => {
              if (event.key === "Escape") setAdding(false);
            }}
          />
          <div>
            <p className="mb-1.5 text-[10px] text-muted-foreground">Schedule</p>
            <CronPicker value={newCron} onChange={setNewCron} />
          </div>
          <div>
            <p className="mb-1.5 text-[10px] text-muted-foreground">Prompt</p>
            <textarea
              value={newPrompt}
              onChange={(event) => setNewPrompt(event.target.value)}
              placeholder="What should this job do?"
              className="min-h-[80px] w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div>
            <p className="mb-1.5 text-[10px] text-muted-foreground">Launcher ID</p>
            <LauncherIdSelect
              value={newLauncherId}
              onChange={setNewLauncherId}
              includeEmpty
              emptyLabel="Inherit agent launcher"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div>
            <p className="mb-1.5 text-[10px] text-muted-foreground">Working Directory</p>
            <input
              value={newCwd}
              onChange={(event) => setNewCwd(event.target.value)}
              placeholder="relative to configured vault"
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => setAdding(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-6 text-[10px]"
              onClick={() => void handleAdd()}
              disabled={!newName.trim() || !newPrompt.trim()}
            >
              Create
            </Button>
          </div>
        </div>
      )}

      {jobs.length === 0 && !adding && (
        <div className="py-8 text-center">
          <Briefcase className="mx-auto h-8 w-8 text-muted-foreground/30" />
          <p className="mt-2 text-[13px] text-muted-foreground">
            No jobs configured
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Jobs are recurring scheduled tasks the agent runs automatically.
          </p>
        </div>
      )}

      {jobs.map((job) => (
        <div key={job.id} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => void toggleJob(job.id)}
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full cursor-pointer",
                  job.enabled ? "bg-green-500" : "bg-muted-foreground/30"
                )}
                title={
                  job.enabled
                    ? "Enabled — click to disable"
                    : "Disabled — click to enable"
                }
              />
              <h4 className="text-[13px] font-medium">{job.name}</h4>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-5 gap-1 px-1.5 text-[10px]"
                onClick={() => void runJob(job.id)}
                disabled={runningJobId === job.id}
              >
                {runningJobId === job.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                Run
              </Button>
              <button
                onClick={() => startEditingJob(job)}
                className={cn(
                  "rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted/80",
                  editingJob === job.id ? "ring-1 ring-primary/50" : ""
                )}
              >
                <span className="font-mono">{job.schedule}</span>
                <span className="ml-1 text-muted-foreground/50">
                  ({cronToHuman(job.schedule)})
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-muted-foreground/40 hover:text-destructive"
                onClick={() => void deleteJob(job.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
          {job.prompt && editingJob !== job.id && (
            <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground/70">
              {job.prompt}
            </p>
          )}
          {editingJob === job.id && (
            <div className="mt-2 space-y-3 border-t border-border pt-2">
              <div>
                <p className="mb-1.5 text-[10px] text-muted-foreground">Schedule</p>
                <CronPicker
                  value={editCron}
                  onChange={(value) => setEditCron(value)}
                  compact
                />
              </div>
              <div>
                <p className="mb-1.5 text-[10px] text-muted-foreground">Prompt</p>
                <textarea
                  value={editPrompt}
                  onChange={(event) => setEditPrompt(event.target.value)}
                  placeholder="What should this job do?"
                  className="min-h-[80px] w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <p className="mb-1.5 text-[10px] text-muted-foreground">Launcher ID</p>
                <LauncherIdSelect
                  value={editLauncherId}
                  onChange={setEditLauncherId}
                  includeEmpty
                  emptyLabel="Inherit agent launcher"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div>
                <p className="mb-1.5 text-[10px] text-muted-foreground">Working Directory</p>
                <input
                  value={editCwd}
                  onChange={(event) => setEditCwd(event.target.value)}
                  placeholder="relative to configured vault"
                  className="w-full rounded border border-border bg-background px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
              </div>
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px]"
                  onClick={() => setEditingJob(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-6 gap-1 text-[10px]"
                  onClick={() => void handleUpdateJob(job.id)}
                >
                  <Save className="h-3 w-3" />
                  Save
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
