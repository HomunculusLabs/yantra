import { NextRequest, NextResponse } from "next/server";
import { readConversationMeta } from "@/lib/agents/conversation-store";
import {
  listRecentAbsurdTasks,
  type RecentAbsurdTaskStateFilter,
} from "@/lib/jobs/absurd-query";

const VALID_STATES = new Set<RecentAbsurdTaskStateFilter>([
  "all",
  "succeeded",
  "failed",
  "cancelled",
  "skipped",
]);

function normalizeTerminalStatus(taskState: string, resultStatus: string | null, conversationStatus: string | null) {
  if (taskState === "cancelled") return "cancelled";
  if (taskState === "failed" || resultStatus === "failed" || conversationStatus === "failed") {
    return "failed";
  }
  if (resultStatus === "skipped") return "skipped";
  return "succeeded";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.max(1, Math.min(50, parseInt(searchParams.get("limit") || "30", 10) || 30));
  const rawState = (searchParams.get("state") || "all") as RecentAbsurdTaskStateFilter;
  const state = VALID_STATES.has(rawState) ? rawState : "all";
  const source = searchParams.get("source")?.trim() || null;
  const agentSlug = searchParams.get("agent")?.trim() || null;
  const query = searchParams.get("query")?.trim() || null;

  try {
    const rows = await listRecentAbsurdTasks({
      limit,
      state,
      source,
      agentSlug,
      query,
    });

    const tasks = await Promise.all(
      rows.map(async (row) => {
        const conversationMeta = row.conversationId
          ? await readConversationMeta(row.conversationId).catch(() => null)
          : null;

        const conversationStatus = conversationMeta?.status || null;

        return {
          ...row,
          title: conversationMeta?.title || row.jobId || row.taskName,
          summary: conversationMeta?.summary || row.summary || row.reason || row.error || null,
          conversationStatus,
          terminalStatus: normalizeTerminalStatus(
            row.taskState,
            row.resultStatus,
            conversationStatus
          ),
        };
      })
    );

    return NextResponse.json({ tasks });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message, tasks: [] }, { status: 500 });
  }
}
