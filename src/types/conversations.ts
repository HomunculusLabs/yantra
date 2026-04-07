import type { AgentPersonaDraft } from "./agent-api";

export type ConversationTrigger = "manual" | "job" | "heartbeat";

export type ConversationStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface ConversationArtifact {
  path: string;
  label?: string;
}

export type ConversationAgentProposalStatus =
  | "pending"
  | "applied"
  | "declined"
  | "parse_error";

export interface ConversationAgentProposal {
  status: ConversationAgentProposalStatus;
  draft: AgentPersonaDraft | null;
  issues: string[];
  createdAgentSlug?: string;
  appliedAt?: string;
  declinedAt?: string;
}

export interface ConversationRuntimeSession {
  launchTransport: "direct" | "tmux";
  tmuxSessionName?: string;
  tmuxAttachCommand?: string;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number | null;
  eventStreamFormat?: ConversationRuntimeEventStreamFormat;
}

export type ConversationRuntimeEventStreamFormat = "structured_v1";

export interface ConversationRuntimeAssistantSnapshot {
  summary?: string;
  body?: string;
  contextSummary?: string;
  artifacts: ConversationArtifact[];
}

export interface ConversationRuntimeSnapshot {
  sessionId: string;
  sequence: number;
  updatedAt: string;
  status: ConversationStatus;
  runtimeSession: ConversationRuntimeSession;
  assistant: ConversationRuntimeAssistantSnapshot;
}

export interface ConversationMeta {
  id: string;
  agentSlug: string;
  title: string;
  trigger: ConversationTrigger;
  status: ConversationStatus;
  startedAt: string;
  completedAt?: string;
  exitCode?: number | null;
  jobId?: string;
  jobName?: string;
  promptPath: string;
  transcriptPath: string;
  mentionedPaths: string[];
  artifactPaths: string[];
  summary?: string;
  contextSummary?: string;
  userMessage?: string;
  pagePath?: string;
  agentProposal?: ConversationAgentProposal;
  runtimeSession?: ConversationRuntimeSession;
}

export type ConversationThreadSource = "structured_session" | "transcript_adapter";

export interface ConversationUserThreadItem {
  kind: "user";
  id: string;
  text: string;
  mentionedPaths: string[];
  pagePath?: string;
}

export interface ConversationSystemThreadItem {
  kind: "system";
  id: string;
  systemType: "runtime_session";
  title: string;
  description?: string;
  command?: string;
  tone: "neutral" | "success" | "warning" | "error";
}

export type ConversationAssistantState =
  | "streaming"
  | "completed"
  | "failed"
  | "cancelled";

export type ConversationAssistantPart =
  | {
      kind: "markdown";
      id: string;
      text: string;
    }
  | {
      kind: "context";
      id: string;
      text: string;
    }
  | {
      kind: "artifact_list";
      id: string;
      artifacts: ConversationArtifact[];
    }
  | {
      kind: "tool_call";
      id: string;
      toolName: string;
      state: "pending" | "completed" | "failed";
      inputSummary?: string;
      outputSummary?: string;
      isError?: boolean;
    };

export interface ConversationAssistantThreadItem {
  kind: "assistant";
  id: string;
  state: ConversationAssistantState;
  summary?: string;
  parts: ConversationAssistantPart[];
}

export type ConversationActionType = "agent_proposal";

export interface ConversationActionThreadItem {
  kind: "action";
  id: string;
  actionType: ConversationActionType;
  sourceConversationId: string;
  proposal: ConversationAgentProposal;
}

export type ConversationThreadItem =
  | ConversationUserThreadItem
  | ConversationSystemThreadItem
  | ConversationAssistantThreadItem
  | ConversationActionThreadItem;

export interface ConversationThread {
  source: ConversationThreadSource;
  items: ConversationThreadItem[];
  streamingItem?: ConversationAssistantThreadItem;
}

export interface ConversationPresentation {
  meta: ConversationMeta;
  transcript: string;
  mentions: string[];
  artifacts: ConversationArtifact[];
  thread: ConversationThread;
}

export interface ConversationPresentationSnapshot
  extends ConversationPresentation {
  version: string;
  emittedAt: string;
}

export interface ConversationDetail extends ConversationPresentation {
  prompt: string;
}
