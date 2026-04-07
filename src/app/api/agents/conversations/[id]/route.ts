import { NextRequest, NextResponse } from "next/server";
import {
  declineConversationAgentProposal,
  readConversationMeta,
  readConversationRecord,
  readConversationDetail,
  restoreConversationAgentProposal,
} from "@/lib/agents/conversation-store";
import { reconcileRunningConversation } from "@/lib/agents/conversation-reconciler";
import { buildConversationPresentation } from "@/lib/agents/conversation-thread";
import { getDaemonSessionRuntimeSnapshot } from "@/lib/agents/daemon-client";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const meta = await readConversationMeta(id);

  if (!meta) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  if (meta.status === "running") {
    await reconcileRunningConversation(meta);
  }

  const record = await readConversationRecord(id);
  if (!record) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  if (
    record.meta.status === "running" &&
    record.meta.runtimeSession?.eventStreamFormat === "structured_v1"
  ) {
    try {
      const runtimeSnapshot = await getDaemonSessionRuntimeSnapshot(id, {
        timeoutMs: 1500,
      });
      return NextResponse.json({
        ...buildConversationPresentation({
          ...record,
          runtimeSnapshot,
        }),
        prompt: record.prompt,
      });
    } catch {
      // fall through to persisted detail
    }
  }

  const detail = await readConversationDetail(id);
  return NextResponse.json(detail);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const meta = await readConversationMeta(id);

  if (!meta) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (!meta.agentProposal) {
    return NextResponse.json(
      { error: "Conversation has no agent proposal" },
      { status: 404 }
    );
  }

  if (action === "decline_agent_proposal") {
    if (meta.status === "running") {
      return NextResponse.json(
        { error: "Source conversation is still running" },
        { status: 409 }
      );
    }
    if (meta.agentProposal.status === "applied") {
      return NextResponse.json(
        { error: "Source conversation proposal was already applied" },
        { status: 409 }
      );
    }
    if (meta.agentProposal.status !== "pending") {
      return NextResponse.json(
        { error: "Source conversation proposal is not pending" },
        { status: 409 }
      );
    }

    const updated = await declineConversationAgentProposal(id);
    if (!updated) {
      return NextResponse.json(
        { error: "Source conversation proposal is no longer pending" },
        { status: 409 }
      );
    }
  } else if (action === "restore_agent_proposal") {
    if (meta.agentProposal.status !== "declined") {
      return NextResponse.json(
        { error: "Source conversation proposal is not declined" },
        { status: 409 }
      );
    }

    const updated = await restoreConversationAgentProposal(id);
    if (!updated) {
      return NextResponse.json(
        { error: "Source conversation proposal is no longer declined" },
        { status: 409 }
      );
    }
  } else {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const detail = await readConversationDetail(id);
  if (!detail) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  return NextResponse.json(detail);
}
