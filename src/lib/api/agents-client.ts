import type {
  AgentSummary,
  CreateAgentPersonaRequest,
  SaveAgentPersonaRequest,
} from "@/types/agent-api";
import type { AgentStackConfig, AgentStackPayload } from "@/types/agent-stack";
import type {
  ConversationDetail,
  ConversationMeta,
  ConversationStatus,
  ConversationTrigger,
} from "@/types/conversations";
import type { JobConfig, JobRun } from "@/types/jobs";

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const fallback =
      response.statusText || `Request failed with status ${response.status}`;
    throw new Error(
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : fallback
    );
  }

  return data as T;
}

export async function listAgentPersonas(): Promise<AgentSummary[]> {
  const data = await requestJson<{ personas?: AgentSummary[] }>(
    "/api/agents/personas"
  );
  return data.personas || [];
}

export async function getAgentPersona(slug: string): Promise<AgentSummary> {
  const data = await requestJson<{ persona: AgentSummary }>(
    `/api/agents/personas/${slug}`
  );
  return data.persona;
}

export async function createAgentPersona(
  payload: CreateAgentPersonaRequest
): Promise<void> {
  await requestJson("/api/agents/personas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function saveAgentPersona(
  slug: string,
  payload: SaveAgentPersonaRequest
): Promise<void> {
  await requestJson(`/api/agents/personas/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function toggleAgentPersona(
  slug: string
): Promise<{ active: boolean }> {
  return requestJson<{ ok: true; active: boolean }>(
    `/api/agents/personas/${slug}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle" }),
    }
  );
}

export async function runAgentPersona(slug: string): Promise<{
  sessionId: string;
  launchTransport?: string;
  tmuxSessionName?: string | null;
  tmuxAttachCommand?: string | null;
}> {
  return requestJson(`/api/agents/personas/${slug}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "run" }),
  });
}

export async function deleteAgentPersona(slug: string): Promise<void> {
  await requestJson(`/api/agents/personas/${slug}`, {
    method: "DELETE",
  });
}

export async function listAgentConversations(params: {
  agentSlug?: string | null;
  trigger?: ConversationTrigger;
  status?: ConversationStatus;
  limit?: number;
}): Promise<ConversationMeta[]> {
  const search = new URLSearchParams();
  if (params.agentSlug) search.set("agent", params.agentSlug);
  if (params.trigger) search.set("trigger", params.trigger);
  if (params.status) search.set("status", params.status);
  search.set("limit", String(params.limit ?? 200));

  const data = await requestJson<{ conversations?: ConversationMeta[] }>(
    `/api/agents/conversations?${search.toString()}`
  );
  return data.conversations || [];
}

export async function getConversationDetail(
  id: string
): Promise<ConversationDetail> {
  return requestJson<ConversationDetail>(`/api/agents/conversations/${id}`);
}

export async function createManualConversation(payload: {
  agentSlug: string;
  userMessage: string;
  mentionedPaths: string[];
}): Promise<ConversationMeta> {
  const data = await requestJson<{ ok: true; conversation: ConversationMeta }>(
    "/api/agents/conversations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return data.conversation;
}

export async function listAgentJobs(slug: string): Promise<JobConfig[]> {
  const data = await requestJson<{ jobs?: JobConfig[] }>(
    `/api/agents/${slug}/jobs`
  );
  return data.jobs || [];
}

export async function createAgentJob(
  slug: string,
  job: JobConfig
): Promise<JobConfig> {
  const data = await requestJson<{ ok: true; job: JobConfig }>(
    `/api/agents/${slug}/jobs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(job),
    }
  );
  return data.job;
}

export async function saveAgentJob(
  slug: string,
  jobId: string,
  updates: Partial<
    Pick<JobConfig, "name" | "schedule" | "prompt" | "timeout" | "enabled">
  >
): Promise<JobConfig> {
  const data = await requestJson<{ ok: true; job: JobConfig }>(
    `/api/agents/${slug}/jobs/${jobId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );
  return data.job;
}

export async function runAgentJob(
  slug: string,
  jobId: string
): Promise<JobRun> {
  const data = await requestJson<{ ok: true; run: JobRun }>(
    `/api/agents/${slug}/jobs/${jobId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "run" }),
    }
  );
  return data.run;
}

export async function deleteAgentJob(
  slug: string,
  jobId: string
): Promise<void> {
  await requestJson(`/api/agents/${slug}/jobs/${jobId}`, {
    method: "DELETE",
  });
}

export async function getAgentStack(slug: string): Promise<AgentStackPayload> {
  return requestJson<AgentStackPayload>(`/api/agents/personas/${slug}/stack`);
}

export async function saveAgentStack(
  slug: string,
  stack: Partial<
    Pick<
      AgentStackConfig,
      "paths" | "contextFiles" | "skills" | "skillsets" | "extraExtensions"
    >
  >
): Promise<{ stackPath: string; stack: AgentStackConfig }> {
  return requestJson(`/api/agents/personas/${slug}/stack`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stack }),
  });
}
