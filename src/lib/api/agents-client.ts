import type {
  AgentDetailResponse,
  AgentExportBundle,
  AgentRelatedFile,
  AgentSessionOutputResponse,
  AgentSummary,
  AgentWorkspaceFile,
  CompanyConfigSummary,
  CreateAgentPersonaRequest,
  CreateDaemonSessionRequest,
  CreateDaemonSessionResponse,
  SaveAgentPersonaRequest,
  SchedulerActionRequest,
  SchedulerStatusResponse,
} from "@/types/agent-api";
import type { AgentStackConfig, AgentStackPayload } from "@/types/agent-stack";
import type { AgentTask, SlackMessage } from "@/types/agents";
import type {
  BrowserDaemonStatus,
  IntegrationConfig,
  LauncherValidationIssue,
  NotificationTestResponse,
  RootsConfig,
  RuntimeSettingsSummary,
} from "@/types/settings";
import type {
  ConversationDetail,
  ConversationMeta,
  ConversationStatus,
  ConversationTrigger,
} from "@/types/conversations";
import type { CreateJobPayload, JobConfig, JobRun, UpdateJobPayload } from "@/types/jobs";

export class RequestJsonError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "RequestJsonError";
    this.status = status;
    this.payload = payload;
  }
}

export function isRequestJsonError(error: unknown): error is RequestJsonError {
  return error instanceof RequestJsonError;
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const fallback =
      response.statusText || `Request failed with status ${response.status}`;
    throw new RequestJsonError(
      typeof data === "object" && data && "error" in data
        ? String(data.error)
        : fallback,
      response.status,
      data
    );
  }

  return data as T;
}

function withSearchParams(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function normalizeAgentSummary(persona: AgentSummary): AgentSummary {
  const runningCount = persona.runningCount ?? 0;
  return {
    ...persona,
    emoji: persona.emoji || "",
    role: persona.role || "",
    department: persona.department || "general",
    type: persona.type || "specialist",
    goals: persona.goals || [],
    channels: persona.channels || [],
    runningCount,
    running: persona.running ?? runningCount > 0,
  };
}

function normalizeAgentDetail(detail: AgentDetailResponse): AgentDetailResponse {
  return {
    ...detail,
    persona: {
      ...normalizeAgentSummary(detail.persona),
      heartbeat: detail.persona.heartbeat,
      department: detail.persona.department || "general",
      type: detail.persona.type || "specialist",
      workspace: detail.persona.workspace || "workspace",
      body: detail.persona.body || "",
      tags: detail.persona.tags || [],
      focus: detail.persona.focus || [],
      channels: detail.persona.channels || [],
      goals: detail.persona.goals || [],
    },
    history: detail.history || [],
    memory: detail.memory || {},
    goalHistory: detail.goalHistory || {},
  };
}

export async function listAgentPersonas(): Promise<AgentSummary[]> {
  const data = await requestJson<{ personas?: AgentSummary[] }>(
    "/api/agents/personas"
  );
  return (data.personas || []).map(normalizeAgentSummary);
}

export async function getAgentPersona(slug: string): Promise<AgentSummary> {
  const data = await requestJson<{ persona: AgentSummary }>(
    `/api/agents/personas/${slug}`
  );
  return normalizeAgentSummary(data.persona);
}

export async function getAgentDetail(
  slug: string
): Promise<AgentDetailResponse> {
  return normalizeAgentDetail(
    await requestJson<AgentDetailResponse>(`/api/agents/personas/${slug}`)
  );
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

export async function getAgentWorkspace(
  slug: string
): Promise<AgentWorkspaceFile[]> {
  const data = await requestJson<{ files?: AgentWorkspaceFile[] }>(
    `/api/agents/personas/${slug}/workspace`
  );
  return data.files || [];
}

export async function getAgentSessionOutput(
  slug: string,
  sessionTs: string
): Promise<string | null> {
  const data = await requestJson<AgentSessionOutputResponse>(
    withSearchParams(`/api/agents/personas/${slug}`, { session: sessionTs })
  );
  return data.output || null;
}

export async function getAgentExportBundle(
  slug: string
): Promise<AgentExportBundle> {
  return requestJson<AgentExportBundle>(`/api/agents/personas/${slug}/export`);
}

export async function getAgentRelatedFiles(
  slug: string
): Promise<AgentRelatedFile[]> {
  const data = await requestJson<{ files?: AgentRelatedFile[] }>(
    `/api/agents/personas/${slug}/files`
  );
  return data.files || [];
}

export async function listSlackMessages(params?: {
  channel?: string;
  limit?: number;
}): Promise<SlackMessage[]> {
  const data = await requestJson<{ messages?: SlackMessage[] }>(
    withSearchParams("/api/agents/slack", {
      channel: params?.channel,
      limit: params?.limit,
    })
  );
  return data.messages || [];
}

export async function listAgentTasks(params: {
  agent?: string;
  all?: boolean;
  status?: AgentTask["status"];
}): Promise<AgentTask[]> {
  const data = await requestJson<{ tasks?: AgentTask[] }>(
    withSearchParams("/api/agents/tasks", {
      agent: params.agent,
      all: params.all ? "true" : undefined,
      status: params.status,
    })
  );
  return data.tasks || [];
}

export async function updateAgentTask(params: {
  agent: string;
  taskId: string;
  status: AgentTask["status"];
  result?: string;
}): Promise<AgentTask> {
  const data = await requestJson<{ task: AgentTask }>("/api/agents/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "update", ...params }),
  });
  return data.task;
}

export async function getCompanyConfig(): Promise<CompanyConfigSummary> {
  const data = await requestJson<Record<string, unknown>>("/api/agents/config");
  const company = data.company;
  const companyName =
    typeof company === "string"
      ? company
      : company && typeof company === "object" && "name" in company
        ? String(company.name || "")
        : "";

  return {
    exists: Boolean(data.exists ?? companyName),
    companyName,
    raw: data,
  };
}

export async function getSchedulerStatus(): Promise<SchedulerStatusResponse> {
  return requestJson<SchedulerStatusResponse>("/api/agents/scheduler");
}

export async function updateScheduler(
  payload: SchedulerActionRequest
): Promise<void> {
  await requestJson("/api/agents/scheduler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function generateAgentDraftFromDescription(
  description: string
): Promise<Partial<CreateAgentPersonaRequest> | null> {
  const data = await requestJson<{ output?: string }>("/api/agents/headless", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instruction: `You are a Yantra Agent creator. Based on the following description, generate a JSON object for creating a new agent. Return ONLY valid JSON, no other text.\n\nDescription: "${description.trim()}"\n\nReturn JSON with these fields:\n{\n  "name": "Agent Name",\n  "slug": "agent-name",\n  "role": "Brief role description",\n  "emoji": "",\n  "department": "marketing|sales|engineering|research|operations|content|support|general",\n  "type": "specialist|lead",\n  "body": "You are [Name]. [2-3 sentence persona description with personality and goals]"\n}\n\nChoose an appropriate department. Leave the emoji field empty. Make the body a compelling persona prompt.`,
    }),
  });

  const output = data.output || "";
  const jsonMatch = output.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  return JSON.parse(jsonMatch[0]) as Partial<CreateAgentPersonaRequest>;
}

export async function importAgentBundle(bundle: unknown): Promise<void> {
  await requestJson("/api/agents/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bundle),
  });
}

export async function getRuntimeSettingsSummary(): Promise<RuntimeSettingsSummary> {
  return requestJson<RuntimeSettingsSummary>("/api/agents/config/runtime");
}

export async function getIntegrationConfig(): Promise<IntegrationConfig> {
  return requestJson<IntegrationConfig>("/api/agents/config/integrations");
}

export async function saveIntegrationConfig(
  config: IntegrationConfig
): Promise<void> {
  await requestJson("/api/agents/config/integrations", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
}

export async function getRootsConfig(): Promise<RootsConfig> {
  return requestJson<RootsConfig>("/api/agents/config/roots");
}

export async function saveRootsConfig(payload: {
  vaultRoot: string;
  runtimeRoot: string;
}): Promise<RootsConfig> {
  return requestJson<RootsConfig>("/api/agents/config/roots", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getLauncherRegistry(): Promise<unknown> {
  return requestJson<unknown>("/api/agents/config/launchers");
}

export async function saveLauncherRegistry(payload: unknown): Promise<void> {
  await requestJson("/api/agents/config/launchers", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function getLauncherValidationIssues(
  error: unknown
): LauncherValidationIssue[] {
  if (!isRequestJsonError(error)) return [];
  const payload = error.payload;
  if (!payload || typeof payload !== "object" || !("details" in payload)) return [];
  return Array.isArray(payload.details)
    ? (payload.details.filter(
        (detail): detail is LauncherValidationIssue =>
          Boolean(
            detail &&
              typeof detail === "object" &&
              "path" in detail &&
              "message" in detail
          )
      ) as LauncherValidationIssue[])
    : [];
}

export async function sendTestNotification(): Promise<NotificationTestResponse> {
  return requestJson<NotificationTestResponse>(
    "/api/agents/config/notifications/test",
    { method: "POST" }
  );
}

export async function probeBrowserDaemonHealth(
  healthUrl?: string
): Promise<BrowserDaemonStatus | null> {
  if (!healthUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(healthUrl, {
      signal: controller.signal,
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || data?.status !== "ok") {
      throw new Error(data?.error || `Daemon health check failed (${response.status})`);
    }
    return { reachable: true, error: null };
  } catch (error) {
    return {
      reachable: false,
      error:
        error instanceof Error ? error.message : "Browser daemon health check failed",
    };
  } finally {
    clearTimeout(timeout);
  }
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
  const data = await requestJson<{ conversations?: ConversationMeta[] }>(
    withSearchParams("/api/agents/conversations", {
      agent: params.agentSlug,
      trigger: params.trigger,
      status: params.status,
      limit: params.limit ?? 200,
    })
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
