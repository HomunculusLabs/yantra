import type { JobExecutionConfig } from "./launchers";

export interface JobPostAction {
  action: "git_commit" | "update_page" | "notify";
  message?: string;
  path?: string;
  channel?: string;
}

export interface JobConfig {
  id: string;
  name: string;
  enabled: boolean;
  schedule: string;
  provider: string;
  agentSlug?: string;
  workdir?: string;
  timeout?: number;
  prompt: string;
  execution?: JobExecutionConfig;
  on_complete?: JobPostAction[];
  on_failure?: JobPostAction[];
  createdAt: string;
  updatedAt: string;
  latestTask?: JobTaskStatus;
}

export interface JobRun {
  id: string;
  jobId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  duration?: number;
  output: string;
}

export type JobTaskState =
  | "pending"
  | "running"
  | "sleeping"
  | "completed"
  | "failed"
  | "cancelled";

export type JobTaskOutcome = "completed" | "failed" | "skipped";

export interface JobTaskStatus {
  taskID: string;
  runID?: string;
  state: JobTaskState;
  outcome?: JobTaskOutcome;
  source?: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string | null;
  conversationId?: string;
  summary?: string | null;
  reason?: string | null;
  exitCode?: number | null;
  error?: string | null;
}
