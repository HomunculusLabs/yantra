import type { GoalMetric } from "./agents";
import type { AgentLaunchConfig } from "./launchers";

export interface AgentSummary {
  name: string;
  slug: string;
  emoji: string;
  role: string;
  active: boolean;
  heartbeat?: string;
  runningCount?: number;
  running?: boolean;
  department?: string;
  type?: string;
  workspace?: string;
  body?: string;
  goals?: GoalMetric[];
  channels?: string[];
  heartbeatsUsed?: number;
  lastHeartbeat?: string;
  nextHeartbeat?: string;
  lastAction?: string;
  pendingTasks?: number;
}

export interface AgentDetailPersona extends AgentSummary {
  heartbeat: string;
  department: string;
  type: string;
  workspace: string;
  body: string;
  tags: string[];
  focus: string[];
  channels: string[];
  goals: GoalMetric[];
  launcher?: AgentLaunchConfig | null;
  heartbeatsUsed?: number;
  lastHeartbeat?: string;
  nextHeartbeat?: string;
}

export interface AgentHeartbeatRecord {
  agentSlug: string;
  timestamp: string;
  duration: number;
  status: "completed" | "failed";
  summary: string;
}

export interface AgentGoalHistoryEntry {
  period: string;
  actual: number;
  target: number;
}

export interface AgentGoalHistoryMetric {
  current: number;
  target: number;
  period_start: string;
  period_end: string;
  history: AgentGoalHistoryEntry[];
}

export type AgentGoalHistory = Record<string, AgentGoalHistoryMetric>;

export interface AgentDetailResponse {
  persona: AgentDetailPersona;
  history: AgentHeartbeatRecord[];
  memory?: Record<string, string>;
  inbox?: unknown;
  goalHistory?: AgentGoalHistory;
}

export interface AgentWorkspaceFile {
  name: string;
  path: string;
  modified?: string;
  type?: "file" | "directory";
}

export interface AgentSessionOutputResponse {
  output: string | null;
}

export interface AgentExportBundle {
  version: number;
  exportedAt: string;
  agent: {
    slug: string;
    frontmatter: Record<string, unknown>;
    body: string;
  };
  workspaceIndex: string | null;
}

export interface CompanyConfigSummary {
  exists: boolean;
  companyName: string;
  raw: unknown;
}

export interface SchedulerAgentStatus {
  slug: string;
  name: string;
  emoji?: string;
  active: boolean;
  scheduled: boolean;
  heartbeat?: string;
  lastHeartbeat?: string;
  nextHeartbeat?: string;
}

export interface SchedulerStatusResponse {
  status: "running" | "stopped";
  scheduledAgents: string[];
  totalAgents: number;
  activeCount: number;
  pausedCount: number;
  agents: SchedulerAgentStatus[];
}

export type SchedulerAction = "start-all" | "stop-all" | "activate" | "pause";

export interface SchedulerActionRequest {
  action: SchedulerAction;
  slugs?: string[];
  exclude?: string[];
}

export interface AgentRelatedFile {
  label: string;
  path: string;
  scope: "vault" | "runtime";
  kind:
    | "persona"
    | "stack"
    | "context"
    | "instruction"
    | "extension"
    | "skill";
  description?: string;
  exists: boolean;
  creatable?: boolean;
}

export interface CreateDaemonSessionRequest {
  prompt: string;
  agentSlug: string;
  sessionId?: string;
  cwd?: string;
  timeoutSeconds?: number;
}

export interface CreateDaemonSessionResponse {
  ok: true;
  sessionId: string;
  tmuxSessionName?: string | null;
  tmuxAttachCommand?: string | null;
}

export interface CreateAgentPersonaRequest {
  slug: string;
  name: string;
  role: string;
  emoji: string;
  department: string;
  type: string;
  heartbeat: string;
  workspace: string;
  provider: string;
  budget: number;
  active: boolean;
  workdir: string;
  focus: string[];
  tags: string[];
  channels: string[];
  body: string;
}

export interface SaveAgentPersonaRequest {
  role?: string;
  department?: string;
  type?: string;
  heartbeat?: string;
  workspace?: string;
  body?: string;
  launcher?: AgentLaunchConfig | null;
}
