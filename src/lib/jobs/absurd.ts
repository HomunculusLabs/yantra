import path from "path";
import { Absurd, type JsonValue, type TaskResultSnapshot } from "absurd-sdk";
import { startJobConversation, waitForConversationCompletion } from "@/lib/agents/conversation-runner";
import { getYantraRoots } from "@/lib/config/yantra-roots";
import type { JobTaskStatus } from "@/types/jobs";
import {
  ensureDirectory,
  fileExists,
  readFileContent,
  writeFileContent,
} from "@/lib/storage/fs-operations";

const DEFAULT_QUEUE_NAME = process.env.YANTRA_ABSURD_QUEUE?.trim() || "agent-jobs";
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

let absurdClient: Absurd | null = null;
let queueReadyPromise: Promise<void> | null = null;
let workerPromise: Promise<AbsurdWorker> | null = null;
let tasksRegistered = false;

interface RunAgentJobParams {
  agentSlug: string;
  jobId: string;
  source?: "manual" | "scheduler" | "api";
}

interface JobTaskRef {
  taskID: string;
  runID: string;
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

function getAbsurdClient(): Absurd {
  if (!absurdClient) {
    absurdClient = new Absurd({
      db: getAbsurdDatabaseUrl(),
      queueName: DEFAULT_QUEUE_NAME,
      defaultMaxAttempts: 3,
      log: console,
    });
  }

  return absurdClient;
}

export function getAbsurdQueueName(): string {
  return DEFAULT_QUEUE_NAME;
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
    startedAt: getString(result?.startedAt),
    completedAt: getString(result?.completedAt),
    conversationId: getString(result?.conversationId),
    summary: getString(result?.summary),
    reason: getString(result?.reason),
    exitCode: getNumber(result?.exitCode),
  };
}

async function ensureAbsurdQueue(): Promise<void> {
  if (!queueReadyPromise) {
    queueReadyPromise = getAbsurdClient()
      .createQueue(DEFAULT_QUEUE_NAME)
      .catch((error) => {
        queueReadyPromise = null;
        throw error;
      });
  }

  await queueReadyPromise;
}

function registerAbsurdTasks(): void {
  if (tasksRegistered) return;

  getAbsurdClient().registerTask<RunAgentJobParams>(
    {
      name: "run-agent-job",
      queue: DEFAULT_QUEUE_NAME,
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
        const result = await waitForConversationCompletion(run.conversationId);
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

  tasksRegistered = true;
}

export async function spawnJobTask(input: SpawnJobTaskInput) {
  await ensureAbsurdQueue();

  const spawned = await getAbsurdClient().spawn(
    "run-agent-job",
    {
      agentSlug: input.agentSlug,
      jobId: input.jobId,
      source: input.source || "manual",
    } satisfies RunAgentJobParams,
    {
      queue: DEFAULT_QUEUE_NAME,
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

  await ensureAbsurdQueue();
  const snapshot = await getAbsurdClient().fetchTaskResult(ref.taskID, {
    queue: DEFAULT_QUEUE_NAME,
  });

  return normalizeTaskStatus(ref, snapshot);
}

export async function startAbsurdJobWorker(): Promise<AbsurdWorker> {
  registerAbsurdTasks();
  await ensureAbsurdQueue();

  if (!workerPromise) {
    workerPromise = getAbsurdClient()
      .startWorker({
        concurrency: DEFAULT_CONCURRENCY,
        batchSize: DEFAULT_CONCURRENCY,
        claimTimeout: DEFAULT_CLAIM_TIMEOUT_SECONDS,
        pollInterval: DEFAULT_POLL_INTERVAL_SECONDS,
        workerId: `yantra-daemon:${process.pid}`,
        fatalOnLeaseTimeout: true,
        onError: (error) => {
          console.error("Absurd worker error:", error);
        },
      })
      .catch((error) => {
        workerPromise = null;
        throw error;
      });
  }

  return workerPromise;
}

export async function closeAbsurdJobWorker(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.close();
    workerPromise = null;
  }

  if (absurdClient) {
    await absurdClient.close();
    absurdClient = null;
  }

  queueReadyPromise = null;
  tasksRegistered = false;
}
