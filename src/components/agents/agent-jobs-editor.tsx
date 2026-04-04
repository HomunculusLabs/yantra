"use client";

import { FileText, Play, Plus, Trash2 } from "lucide-react";
import { SchedulePicker } from "@/components/mission-control/schedule-picker";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { cronToHuman } from "@/lib/agents/cron-utils";
import type { JobConfig } from "@/types/jobs";

interface AgentJobsEditorProps {
  jobs: JobConfig[];
  selectedJobId: string | null;
  jobDraft: JobConfig | null;
  onStartNewJobDraft: () => void;
  onOpenJob: (jobId: string) => void;
  onRunJob: (jobId: string) => void;
  onDeleteJob: (jobId: string) => void;
  onSaveJob: () => void;
  onJobDraftChange: (job: JobConfig) => void;
}

export function AgentJobsEditor({
  jobs,
  selectedJobId,
  jobDraft,
  onStartNewJobDraft,
  onOpenJob,
  onRunJob,
  onDeleteJob,
  onSaveJob,
  onJobDraftChange,
}: AgentJobsEditorProps) {
  return (
    <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-4">
      <div className="rounded-xl border border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h4 className="text-[13px] font-semibold">Jobs</h4>
            <p className="text-[11px] text-muted-foreground">
              Recurring jobs and scheduled prompts for this agent
            </p>
          </div>
          <Button size="sm" className="h-8 gap-1 text-xs" onClick={onStartNewJobDraft}>
            <Plus className="h-3.5 w-3.5" />
            Add job
          </Button>
        </div>
        <div className="space-y-1 p-2">
          {jobs.length === 0 ? (
            <div className="px-2 py-6 text-[12px] text-muted-foreground">
              No jobs yet.
            </div>
          ) : (
            jobs.map((job) => (
              <button
                key={job.id}
                onClick={() => onOpenJob(job.id)}
                className={cn(
                  "w-full rounded-lg border px-3 py-3 text-left transition-colors",
                  selectedJobId === job.id
                    ? "border-primary/30 bg-primary/5"
                    : "border-border hover:bg-accent/40"
                )}
              >
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate text-[12px] font-medium">{job.name}</span>
                  <span
                    className={cn(
                      "ml-auto rounded-full px-1.5 py-0.5 text-[10px]",
                      job.enabled
                        ? "bg-emerald-500/10 text-emerald-500"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {job.enabled ? "On" : "Off"}
                  </span>
                </div>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {cronToHuman(job.schedule)}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border p-4">
        {jobDraft ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-[13px] font-semibold">
                  {selectedJobId === "__new__" ? "New job" : "Job settings"}
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  Prompts relevant to the agent that run on a schedule
                </p>
              </div>
              <div className="flex gap-2">
                {selectedJobId && selectedJobId !== "__new__" ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 gap-1 text-xs"
                      onClick={() => onRunJob(selectedJobId)}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Run
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 text-xs text-destructive"
                      onClick={() => onDeleteJob(selectedJobId)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </>
                ) : null}
                <Button size="sm" className="h-8 text-xs" onClick={onSaveJob}>
                  Save job
                </Button>
              </div>
            </div>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              <span>Name</span>
              <input
                value={jobDraft.name}
                onChange={(event) =>
                  onJobDraftChange({ ...jobDraft, name: event.target.value })
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
              />
            </label>
            <div className="space-y-1">
              <SchedulePicker
                label="Schedule"
                value={jobDraft.schedule}
                onChange={(schedule) =>
                  onJobDraftChange({ ...jobDraft, schedule })
                }
              />
            </div>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              <span>Timeout (seconds)</span>
              <input
                type="number"
                value={jobDraft.timeout || 600}
                onChange={(event) =>
                  onJobDraftChange({
                    ...jobDraft,
                    timeout: parseInt(event.target.value || "600", 10),
                  })
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
              />
            </label>
            <label className="space-y-1 text-[11px] text-muted-foreground">
              <span>Prompt</span>
              <textarea
                value={jobDraft.prompt}
                onChange={(event) =>
                  onJobDraftChange({ ...jobDraft, prompt: event.target.value })
                }
                className="min-h-[220px] w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground"
              />
            </label>
          </div>
        ) : (
          <div className="flex h-full min-h-[280px] items-center justify-center text-[12px] text-muted-foreground">
            Select a job to edit its settings, or create a new one.
          </div>
        )}
      </div>
    </div>
  );
}
