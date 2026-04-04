import type {
  AgentDetailResponse,
  AgentRelatedFile,
  AgentSummary,
  CreateAgentPersonaRequest,
  CreateDaemonSessionRequest,
  CreateDaemonSessionResponse,
  SaveAgentPersonaRequest,
} from "@/types/agent-api";
import type { AgentStackConfig, AgentStackPayload } from "@/types/agent-stack";
import type {
  ConversationDetail,
  ConversationMeta,
  ConversationStatus,
  ConversationTrigger,
} from "@/types/conversations";
import type { CreateJobPayload, JobConfig, JobRun, UpdateJobPayload } from "@/types/jobs";

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

export async function getAgentDetail(
  slug: string
): Promise<AgentDetailResponse> {
  return requestJson<AgentDetailResponse>(`/api/agents/personas/${slug}`);
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

export async function getAgentRelatedFiles(
  slug: string
): Promise<AgentRelatedFile[]> {
  const data = await requestJson<{ files?: AgentRelatedFile[] }>(
    `/api/agents/personas/${slug}/files`
  );
  return data.files || [];
}

export async function renderMarkdownPreview(payload: {
  markdown: string;
  pagePath?: string;
}): Promise<string> {
  const data = await requestJson<{ html?: string }>("/api/ai/render-md", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return data.html || "";
}

export async function createDaemonSession(
  payload: CreateDaemonSessionRequest
): Promise<CreateDaemonSessionResponse> {
  return requestJson<CreateDaemonSessionResponse>("/api/daemon/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
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
  job: CreateJobPayload | JobConfig
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
  updates: UpdateJobPayload
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

export async function toggleAgentJob(
  slug: string,
  jobId: string
): Promise<JobConfig> {
  const data = await requestJson<{ ok: true; job: JobConfig }>(
    `/api/agents/${slug}/jobs/${jobId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle" }),
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
