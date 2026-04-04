import type { AgentType, GoalMetric } from "@/types/agents";
import type { AgentLaunchConfig } from "@/types/launchers";

export interface AgentPersona {
  name: string;
  role: string;
  provider: string;
  heartbeat: string;
  budget: number;
  active: boolean;
  workdir: string;
  focus: string[];
  tags: string[];
  emoji: string;
  department: string;
  type: AgentType;
  goals: GoalMetric[];
  channels: string[];
  workspace: string;
  output_dir?: string;
  launcher?: AgentLaunchConfig;
  slug: string;
  body: string;
  heartbeatsUsed?: number;
  lastHeartbeat?: string;
  nextHeartbeat?: string;
}

export interface HeartbeatRecord {
  agentSlug: string;
  timestamp: string;
  duration: number;
  status: "completed" | "failed";
  summary: string;
}
