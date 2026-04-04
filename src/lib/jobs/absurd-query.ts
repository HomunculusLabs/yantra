import { Pool } from "pg";
import { getAbsurdQueueName, RUN_AGENT_JOB_TASK_NAME } from "@/lib/jobs/absurd";

let absurdPool: Pool | null = null;

export type RecentAbsurdTaskStateFilter =
  | "all"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export interface RecentAbsurdTaskRow {
  taskId: string;
  runId: string | null;
  taskName: string;
  taskState: string;
  runState: string | null;
  attempt: number | null;
  agentSlug: string | null;
  jobId: string | null;
  source: string | null;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  resultStatus: string | null;
  conversationId: string | null;
  summary: string | null;
  reason: string | null;
  exitCode: number | null;
  error: string | null;
}

export interface ListRecentAbsurdTaskOptions {
  limit?: number;
  state?: RecentAbsurdTaskStateFilter;
  source?: string | null;
  agentSlug?: string | null;
  query?: string | null;
}

function getAbsurdDatabaseUrl(): string {
  const url = process.env.ABSURD_DATABASE_URL?.trim();
  if (!url) {
    throw new Error("ABSURD_DATABASE_URL is not configured");
  }
  return url;
}

function getPool(): Pool {
  if (!absurdPool) {
    absurdPool = new Pool({
      connectionString: getAbsurdDatabaseUrl(),
    });
  }

  return absurdPool;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

export async function listRecentAbsurdTasks(
  options: ListRecentAbsurdTaskOptions = {}
): Promise<RecentAbsurdTaskRow[]> {
  const {
    limit = 12,
    state = "all",
    source = null,
    agentSlug = null,
    query = null,
  } = options;

  const queueName = getAbsurdQueueName();
  const tasksTable = quoteIdentifier(`t_${queueName}`);
  const runsTable = quoteIdentifier(`r_${queueName}`);

  const agentExpr = `COALESCE(t.completed_payload->>'agentSlug', t.params->>'agentSlug', t.headers->>'agentSlug')`;
  const jobExpr = `COALESCE(t.completed_payload->>'jobId', t.params->>'jobId', t.headers->>'jobId')`;
  const sourceExpr = `COALESCE(t.completed_payload->>'source', t.params->>'source', t.headers->>'source')`;
  const resultExpr = `COALESCE(t.completed_payload->>'status', r.result->>'status')`;
  const conversationExpr = `COALESCE(t.completed_payload->>'conversationId', r.result->>'conversationId')`;
  const summaryExpr = `COALESCE(t.completed_payload->>'summary', r.result->>'summary')`;
  const reasonExpr = `COALESCE(t.completed_payload->>'reason', r.result->>'reason')`;
  const errorExpr = `CASE
    WHEN jsonb_typeof(r.failure_reason) = 'object' THEN COALESCE(r.failure_reason->>'message', r.failure_reason::text)
    ELSE r.failure_reason::text
  END`;

  const clauses = [
    `t.task_name = '${RUN_AGENT_JOB_TASK_NAME}'`,
    `t.state IN ('completed', 'failed', 'cancelled')`,
  ];
  const params: Array<string | number> = [];

  if (state !== "all") {
    if (state === "failed") {
      clauses.push(`(t.state = 'failed' OR ${resultExpr} = 'failed')`);
    } else if (state === "cancelled") {
      clauses.push(`t.state = 'cancelled'`);
    } else if (state === "skipped") {
      clauses.push(`t.state = 'completed' AND ${resultExpr} = 'skipped'`);
    } else if (state === "succeeded") {
      clauses.push(`t.state = 'completed' AND COALESCE(${resultExpr}, 'completed') = 'completed'`);
    }
  }

  if (source?.trim()) {
    params.push(source.trim());
    clauses.push(`${sourceExpr} = $${params.length}`);
  }

  if (agentSlug?.trim()) {
    params.push(agentSlug.trim());
    clauses.push(`${agentExpr} = $${params.length}`);
  }

  if (query?.trim()) {
    params.push(`%${query.trim()}%`);
    const index = params.length;
    clauses.push(`(
      ${agentExpr} ILIKE $${index}
      OR ${jobExpr} ILIKE $${index}
      OR ${sourceExpr} ILIKE $${index}
      OR ${summaryExpr} ILIKE $${index}
      OR ${reasonExpr} ILIKE $${index}
      OR ${errorExpr} ILIKE $${index}
      OR ${conversationExpr} ILIKE $${index}
      OR t.task_id::text ILIKE $${index}
    )`);
  }

  params.push(Math.max(1, Math.min(100, limit)));

  const sql = `
    SELECT
      t.task_id::text AS "taskId",
      t.task_name AS "taskName",
      t.state AS "taskState",
      t.enqueue_at::text AS "queuedAt",
      t.first_started_at::text AS "startedAt",
      r.run_id::text AS "runId",
      r.state AS "runState",
      r.attempt AS "attempt",
      ${agentExpr} AS "agentSlug",
      ${jobExpr} AS "jobId",
      ${sourceExpr} AS "source",
      COALESCE(r.completed_at::text, r.failed_at::text, t.first_started_at::text, t.enqueue_at::text) AS "finishedAt",
      ${resultExpr} AS "resultStatus",
      ${conversationExpr} AS "conversationId",
      ${summaryExpr} AS "summary",
      ${reasonExpr} AS "reason",
      COALESCE((t.completed_payload->>'exitCode')::integer, (r.result->>'exitCode')::integer) AS "exitCode",
      ${errorExpr} AS "error"
    FROM absurd.${tasksTable} t
    LEFT JOIN absurd.${runsTable} r
      ON r.run_id = t.last_attempt_run
    WHERE ${clauses.join("\n      AND ")}
    ORDER BY COALESCE(r.completed_at, r.failed_at, t.first_started_at, t.enqueue_at) DESC
    LIMIT $${params.length}
  `;

  const result = await getPool().query(sql, params);
  return result.rows as RecentAbsurdTaskRow[];
}
