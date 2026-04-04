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
}
