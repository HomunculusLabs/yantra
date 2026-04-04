import path from "path";
import { Absurd, type JsonValue, type TaskResultSnapshot } from "absurd-sdk";
import {
  resolveCompletionTimeoutSeconds,
  startJobConversation,
  waitForConversationCompletion,
} from "@/lib/agents/conversation-runner";
import { getYantraRoots } from "@/lib/config/yantra-roots";
import type { JobTaskStatus } from "@/types/jobs";
import {
  ensureDirectory,
  fileExists,
  readFileContent,
  writeFileContent,
} from "@/lib/storage/fs-operations";

const DEFAULT_QUEUE_PREFIX = process.env.YANTRA_ABSURD_QUEUE?.trim() || "agent-jobs";
export const RUN_AGENT_JOB_TASK_NAME = "run-agent-job";
const DEFAULT_CLAIM_TIMEOUT_SECONDS = Number(process.env.YANTRA_ABSURD_CLAIM_TIMEOUT || 3600);
const DEFAULT_CONCURRENCY = Number(process.env.YANTRA_ABSURD_WORKER_CONCURRENCY || 2);
const DEFAULT_POLL_INTERVAL_SECONDS = Number(process.env.YANTRA_ABSURD_POLL_INTERVAL || 0.25);
const TASK_STATE_DIR = path.join(getYantraRoots().runtimeJobsRoot, ".absurd");

type AbsurdWorker = Awaited<ReturnType<Absurd["startWorker"]>>;

export interface SpawnJobTaskInput {
  agentSlug: string;
  jobId: string;
  source?: "manual" | "scheduler" | "api";
  idempotencyKey?: string;
}

let absurdClients = new Map<string, Absurd>();
let queueReadyPromises = new Map<string, Promise<void>>();
let workerPromises = new Map<string, Promise<AbsurdWorker>>();
let tasksRegisteredQueues = new Set<string>();

interface RunAgentJobParams {
  agentSlug: string;
  jobId: string;
  source?: "manual" | "scheduler" | "api";
}

interface JobTaskRef {
  taskID: string;
  runID: string;
  queueName?: string;
  source?: "manual" | "scheduler" | "api";
  queuedAt: string;
}

function getAbsurdDatabaseUrl(): string {
  const url = process.env.ABSURD_DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "ABSURD_DATABASE_URL is required for durable job execution. " +
      "Point it at a Postgres database initialized with the Absurd schema."
    );
  }

  return url;
}

function sanitizeQueueSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "agent";
}

function getAbsurdClient(queueName = getAbsurdQueuePrefix()): Absurd {
  const existing = absurdClients.get(queueName);
  if (existing) return existing;

  const client = new Absurd({
    db: getAbsurdDatabaseUrl(),
    queueName,
    defaultMaxAttempts: 3,
    log: console,
  });

  absurdClients.set(queueName, client);
  return client;
}

export function getAbsurdQueuePrefix(): string {
  return DEFAULT_QUEUE_PREFIX;
}

export function getAbsurdQueueName(agentSlug?: string | null): string {
  if (!agentSlug) return DEFAULT_QUEUE_PREFIX;
  return `${DEFAULT_QUEUE_PREFIX}-${sanitizeQueueSegment(agentSlug)}`;
}

export function getAbsurdWorkerQueueNames(): string[] {
  return Array.from(workerPromises.keys()).sort();
}

async function listManagedQueueNames(agentSlugs: string[] = []): Promise<string[]> {
  const queueNames = new Set<string>([getAbsurdQueuePrefix()]);
  for (const slug of agentSlugs) {
    if (!slug) continue;
    queueNames.add(getAbsurdQueueName(slug));
  }

  const existingQueues = await getAbsurdClient(getAbsurdQueuePrefix()).listQueues();
  for (const queueName of existingQueues) {
    if (
      queueName === getAbsurdQueuePrefix() ||
      queueName.startsWith(`${getAbsurdQueuePrefix()}-`)
    ) {
      queueNames.add(queueName);
    }
  }

  return Array.from(queueNames).sort();
}

function getJobTaskRefPath(agentSlug: string, jobId: string): string {
  return path.join(TASK_STATE_DIR, agentSlug, `${jobId}.json`);
}

async function persistLatestJobTaskRef(
  agentSlug: string,
  jobId: string,
  ref: JobTaskRef
): Promise<void> {
  const filePath = getJobTaskRefPath(agentSlug, jobId);
  await ensureDirectory(path.dirname(filePath));
  await writeFileContent(filePath, JSON.stringify(ref, null, 2));
}

async function readLatestJobTaskRef(
  agentSlug: string,
  jobId: string
): Promise<JobTaskRef | null> {
  const filePath = getJobTaskRefPath(agentSlug, jobId);
  if (!(await fileExists(filePath))) return null;

  try {
    const raw = await readFileContent(filePath);
    return JSON.parse(raw) as JobTaskRef;
  } catch {
    return null;
  }
}

function asRecord(value: JsonValue | null | undefined): Record<string, JsonValue> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, JsonValue>;
}

function getString(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function getNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" ? value : null;
}

function normalizeTaskStatus(ref: JobTaskRef, snapshot: TaskResultSnapshot | null): JobTaskStatus | null {
  if (!snapshot) return null;

  if (
    snapshot.state === "pending" ||
    snapshot.state === "running" ||
    snapshot.state === "sleeping" ||
    snapshot.state === "cancelled"
  ) {
    return {
      taskID: ref.taskID,
      runID: ref.runID,
      state: snapshot.state,
      source: ref.source,
      queuedAt: ref.queuedAt,
      reason: snapshot.state === "cancelled" ? "cancelled" : null,
    };
  }

  if (snapshot.state === "failed") {
    const failure = asRecord(snapshot.failure);
    return {
      taskID: ref.taskID,
      runID: ref.runID,
      state: "failed",
      source: ref.source,
      queuedAt: ref.queuedAt,
      error: getString(failure?.message) || getString(snapshot.failure) || "Task failed",
      reason: getString(failure?.reason),
    };
  }

  if (snapshot.state !== "completed") {
    return null;
  }

  const result = asRecord(snapshot.result);
  return {
    taskID: ref.taskID,
    runID: ref.runID,
    state: "completed",
    outcome:
      getString(result?.status) === "completed" ||
      getString(result?.status) === "failed" ||
      getString(result?.status) === "skipped"
        ? (getString(result?.status) as JobTaskStatus["outcome"])
        : undefined,
    source: ref.source,
    queuedAt: ref.queuedAt,
    startedAt: getString(result?.startedAt) ?? undefined,
    completedAt: getString(result?.completedAt) ?? undefined,
    conversationId: getString(result?.conversationId) ?? undefined,
    summary: getString(result?.summary) ?? undefined,
    reason: getString(result?.reason) ?? undefined,
    exitCode: getNumber(result?.exitCode) ?? undefined,
  };
}

async function ensureAbsurdQueue(queueName: string): Promise<void> {
  const existing = queueReadyPromises.get(queueName);
  if (existing) {
    await existing;
    return;
  }

  const promise = getAbsurdClient(queueName)
    .createQueue(queueName)
    .catch((error) => {
      queueReadyPromises.delete(queueName);
      throw error;
    });

  queueReadyPromises.set(queueName, promise);
  await promise;
}

function registerAbsurdTasks(queueName: string): void {
  if (tasksRegisteredQueues.has(queueName)) return;

  getAbsurdClient(queueName).registerTask<RunAgentJobParams>(
    {
      name: RUN_AGENT_JOB_TASK_NAME,
      queue: queueName,
      defaultMaxAttempts: 3,
    },
    async (params, ctx) => {
      const { loadAgentJobsBySlug } = await import("./job-manager");

      const jobs = await loadAgentJobsBySlug(params.agentSlug);
      const job = jobs.find((entry) => entry.id === params.jobId);

      if (!job) {
        return {
          status: "skipped",
          reason: "job_not_found",
          agentSlug: params.agentSlug,
          jobId: params.jobId,
          source: params.source || "scheduler",
        };
      }

      if (!job.enabled) {
        return {
          status: "skipped",
          reason: "job_disabled",
          agentSlug: params.agentSlug,
          jobId: params.jobId,
          source: params.source || "scheduler",
        };
      }

      const run = await ctx.step("start-conversation", async () => {
        const started = await startJobConversation(job);
        return {
          conversationId: started.id,
          startedAt: started.startedAt,
        };
      });

      const completion = await ctx.step("wait-for-conversation", async () => {
        const result = await waitForConversationCompletion(run.conversationId, {
          timeoutSeconds: resolveCompletionTimeoutSeconds(job.timeout || 600),
        });
        return {
          status: result.status,
          completedAt: result.meta.completedAt || null,
          exitCode: result.meta.exitCode ?? null,
          summary: result.meta.summary || null,
        };
      });

      return {
        agentSlug: params.agentSlug,
        jobId: params.jobId,
        source: params.source || "scheduler",
        conversationId: run.conversationId,
        startedAt: run.startedAt,
        ...completion,
      };
    }
  );

  tasksRegisteredQueues.add(queueName);
}

export async function spawnJobTask(input: SpawnJobTaskInput) {
  const queueName = getAbsurdQueueName(input.agentSlug);
  await ensureAbsurdQueue(queueName);

  const spawned = await getAbsurdClient(queueName).spawn(
    RUN_AGENT_JOB_TASK_NAME,
    {
      agentSlug: input.agentSlug,
      jobId: input.jobId,
      source: input.source || "manual",
    } satisfies RunAgentJobParams,
    {
      queue: queueName,
      maxAttempts: 3,
      retryStrategy: {
        kind: "exponential",
        baseSeconds: 10,
        factor: 2,
        maxSeconds: 300,
      },
      headers: {
        agentSlug: input.agentSlug,
        jobId: input.jobId,
        source: input.source || "manual",
      },
      idempotencyKey: input.idempotencyKey,
    }
  );

  await persistLatestJobTaskRef(input.agentSlug, input.jobId, {
    taskID: spawned.taskID,
    runID: spawned.runID,
    queueName,
    source: input.source || "manual",
    queuedAt: new Date().toISOString(),
  });

  return spawned;
}

export async function getLatestJobTaskStatus(
  agentSlug: string,
  jobId: string
): Promise<JobTaskStatus | null> {
  const ref = await readLatestJobTaskRef(agentSlug, jobId);
  if (!ref) return null;

  const legacyQueueName = getAbsurdQueuePrefix();
  const primaryQueueName = ref.queueName || getAbsurdQueueName(agentSlug);

  let snapshot: TaskResultSnapshot | null = null;

  if (!ref.queueName && legacyQueueName !== primaryQueueName) {
    await ensureAbsurdQueue(legacyQueueName);
    snapshot = await getAbsurdClient(legacyQueueName).fetchTaskResult(ref.taskID, {
      queue: legacyQueueName,
    });
  }

  if (!snapshot) {
    await ensureAbsurdQueue(primaryQueueName);
    snapshot = await getAbsurdClient(primaryQueueName).fetchTaskResult(ref.taskID, {
      queue: primaryQueueName,
    });
  }

  return normalizeTaskStatus(ref, snapshot);
}

async function startAbsurdWorkerForQueue(queueName: string): Promise<AbsurdWorker> {
  registerAbsurdTasks(queueName);
  await ensureAbsurdQueue(queueName);

  const existing = workerPromises.get(queueName);
  if (existing) {
    return existing;
  }

  const promise = getAbsurdClient(queueName)
    .startWorker({
      concurrency: DEFAULT_CONCURRENCY,
      batchSize: DEFAULT_CONCURRENCY,
      claimTimeout: DEFAULT_CLAIM_TIMEOUT_SECONDS,
      pollInterval: DEFAULT_POLL_INTERVAL_SECONDS,
      workerId: `yantra-daemon:${process.pid}:${queueName}`,
      fatalOnLeaseTimeout: true,
      onError: (error) => {
        console.error(`Absurd worker error for queue ${queueName}:`, error);
      },
    })
    .catch((error) => {
      workerPromises.delete(queueName);
      throw error;
    });

  workerPromises.set(queueName, promise);
  return promise;
}

export async function startAbsurdJobWorker(agentSlugs: string[] = []): Promise<AbsurdWorker[]> {
  const queueNames = await listManagedQueueNames(agentSlugs);
  return Promise.all(queueNames.map((queueName) => startAbsurdWorkerForQueue(queueName)));
}

export async function closeAbsurdJobWorker(): Promise<void> {
  const workers = Array.from(workerPromises.values());
  workerPromises = new Map();

  for (const workerPromise of workers) {
    const worker = await workerPromise;
    await worker.close();
  }

  const clients = Array.from(absurdClients.values());
  absurdClients = new Map();

  for (const client of clients) {
    await client.close();
  }

  queueReadyPromises = new Map();
  tasksRegisteredQueues = new Set();
}
