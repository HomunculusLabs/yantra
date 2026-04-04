import { Pool } from "pg";
import { getAbsurdQueuePrefix, RUN_AGENT_JOB_TASK_NAME } from "@/lib/jobs/absurd";

let absurdPool: Pool | null = null;

export type RecentAbsurdTaskStateFilter =
  | "all"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "skipped";

export interface RecentAbsurdTaskRow {
  queueName: string;
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

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function listRecentTaskQueueNames(): Promise<string[]> {
  const prefix = getAbsurdQueuePrefix();
  const result = await getPool().query<{ queue_name: string }>(
    `
      SELECT queue_name
      FROM absurd.queues
      WHERE queue_name = $1 OR queue_name LIKE $2
      ORDER BY created_at DESC
    `,
    [prefix, `${prefix}-%`]
  );

  return result.rows.map((row) => row.queue_name);
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

  const queueNames = await listRecentTaskQueueNames();
  if (queueNames.length === 0) return [];

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
    `t.task_name = ${quoteLiteral(RUN_AGENT_JOB_TASK_NAME)}`,
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

  const subqueries = queueNames.map((queueName) => {
    const tasksTable = quoteIdentifier(`t_${queueName}`);
    const runsTable = quoteIdentifier(`r_${queueName}`);

    return `
      SELECT
        ${quoteLiteral(queueName)} AS "queueName",
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
        COALESCE(r.completed_at, r.failed_at, t.first_started_at, t.enqueue_at) AS "finishedAtSort",
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
      WHERE ${clauses.join("\n        AND ")}
    `;
  });

  const sql = `
    SELECT
      recent_tasks."queueName",
      recent_tasks."taskId",
      recent_tasks."runId",
      recent_tasks."taskName",
      recent_tasks."taskState",
      recent_tasks."runState",
      recent_tasks."attempt",
      recent_tasks."agentSlug",
      recent_tasks."jobId",
      recent_tasks."source",
      recent_tasks."queuedAt",
      recent_tasks."startedAt",
      recent_tasks."finishedAt",
      recent_tasks."resultStatus",
      recent_tasks."conversationId",
      recent_tasks."summary",
      recent_tasks."reason",
      recent_tasks."exitCode",
      recent_tasks."error"
    FROM (
      ${subqueries.join("\n      UNION ALL\n")}
    ) recent_tasks
    ORDER BY recent_tasks."finishedAtSort" DESC NULLS LAST
    LIMIT $${params.length}
  `;

  const result = await getPool().query(sql, params);
  return result.rows as RecentAbsurdTaskRow[];
}
