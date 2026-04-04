import { NextRequest, NextResponse } from "next/server";
import {
  buildEditorConversationPrompt,
  buildManualConversationPrompt,
  startConversationRun,
} from "@/lib/agents/conversation-runner";
import {
  finalizeConversation,
  listConversationMetas,
  readConversationTranscript,
} from "@/lib/agents/conversation-store";
import {
  getDaemonSessionOutput,
  listDaemonSessions,
} from "@/lib/agents/daemon-client";
import type { ConversationMeta } from "@/types/conversations";
import { readMemory, writeMemory } from "@/lib/agents/persona-manager";

async function reconcileRunningConversations(
  conversations: ConversationMeta[]
): Promise<ConversationMeta[]> {
  const running = conversations.filter((conversation) => conversation.status === "running");
  if (running.length === 0) {
    return conversations;
  }

  let daemonSessions: Awaited<ReturnType<typeof listDaemonSessions>>;
  try {
    daemonSessions = await listDaemonSessions({ timeoutMs: 1500 });
  } catch {
    return conversations;
  }

  const daemonById = new Map(daemonSessions.map((session) => [session.id, session]));

  return Promise.all(
    conversations.map(async (conversation) => {
      if (conversation.status !== "running") {
        return conversation;
      }

      const daemonSession = daemonById.get(conversation.id);
      if (!daemonSession) {
        const transcript = await readConversationTranscript(conversation.id).catch(() => "");
        return (
          (await finalizeConversation(conversation.id, {
            status: "failed",
            output:
              transcript ||
              "Conversation was left marked as running, but no live daemon session exists.",
            exitCode: 1,
          })) || conversation
        );
      }

      if (!daemonSession.exited) {
        return conversation;
      }

      try {
        const output = await getDaemonSessionOutput(conversation.id, { timeoutMs: 1500 });
        return (
          (await finalizeConversation(conversation.id, {
            status: output.status === "completed" ? "completed" : "failed",
            output: output.output,
            exitCode:
              daemonSession.exitCode ?? (output.status === "completed" ? 0 : 1),
          })) || conversation
        );
      } catch {
        const transcript = await readConversationTranscript(conversation.id).catch(() => "");
        return (
          (await finalizeConversation(conversation.id, {
            status: daemonSession.exitCode === 0 ? "completed" : "failed",
            output:
              transcript ||
              `Conversation session exited${
                daemonSession.exitCode != null ? ` (${daemonSession.exitCode})` : ""
              }.`,
            exitCode: daemonSession.exitCode,
          })) || conversation
        );
      }
    })
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentSlug = searchParams.get("agent") || undefined;
  const trigger = searchParams.get("trigger") as
    | "manual"
    | "job"
    | "heartbeat"
    | null;
  const status = searchParams.get("status") as
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | null;
  const limit = parseInt(searchParams.get("limit") || "200", 10);

  const conversations = await listConversationMetas({
    agentSlug: agentSlug && agentSlug !== "all" ? agentSlug : undefined,
    trigger: trigger || undefined,
    status: status || undefined,
    limit,
  });

  const reconciled = await reconcileRunningConversations(conversations);

  return NextResponse.json({ conversations: reconciled });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const source = body.source === "editor" ? "editor" : "manual";
    const agentSlug = source === "editor" ? "editor" : body.agentSlug || "general";
    const userMessage = (body.userMessage || "").trim();
    const mentionedPaths = Array.isArray(body.mentionedPaths)
      ? body.mentionedPaths.filter((value: unknown): value is string => typeof value === "string")
      : [];
    const pagePath =
      typeof body.pagePath === "string" && body.pagePath.trim()
        ? body.pagePath.trim()
        : undefined;

    if (!userMessage) {
      return NextResponse.json(
        { error: "userMessage is required" },
        { status: 400 }
      );
    }

    if (source === "editor" && !pagePath) {
      return NextResponse.json(
        { error: "pagePath is required for editor conversations" },
        { status: 400 }
      );
    }

    const conversationInput =
      source === "editor" && pagePath
        ? await buildEditorConversationPrompt({
            pagePath,
            userMessage,
            mentionedPaths,
          })
        : await buildManualConversationPrompt({
            agentSlug,
            userMessage,
            mentionedPaths,
          });

    const conversation = await startConversationRun({
      agentSlug,
      title: conversationInput.title,
      trigger: "manual",
      prompt: conversationInput.prompt,
      mentionedPaths:
        "mentionedPaths" in conversationInput
          ? conversationInput.mentionedPaths
          : mentionedPaths,
      cwd: conversationInput.cwd,
      onComplete: async (completion) => {
        if (agentSlug === "general" || !completion.meta.contextSummary) return;
        const timestamp = new Date().toISOString();
        const existingContext = await readMemory(agentSlug, "context.md");
        const nextEntry = `\n\n## ${timestamp}\n${completion.meta.contextSummary}`;
        await writeMemory(agentSlug, "context.md", existingContext + nextEntry);
      },
    });

    return NextResponse.json({ ok: true, conversation }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
