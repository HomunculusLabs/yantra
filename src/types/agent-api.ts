import type { AgentLaunchConfig } from "./launchers";

export interface AgentSummary {
  name: string;
  slug: string;
  emoji: string;
  role: string;
  active: boolean;
  heartbeat?: string;
  runningCount?: number;
  department?: string;
  type?: string;
  workspace?: string;
  body?: string;
}

export interface AgentDetailPersona extends AgentSummary {
  heartbeat: string;
  department: string;
  type: string;
  workspace: string;
  body: string;
  tags: string[];
  focus: string[];
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

export interface AgentDetailResponse {
  persona: AgentDetailPersona;
  history: AgentHeartbeatRecord[];
  memory?: Record<string, string>;
  inbox?: unknown;
  goalHistory?: unknown;
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
