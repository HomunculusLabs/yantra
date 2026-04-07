import { NextRequest, NextResponse } from "next/server";
import {
  finalizeConversation,
  readConversationMeta,
  readConversationRecord,
  type ConversationReadRecord,
} from "@/lib/agents/conversation-store";
import { reconcileRunningConversation } from "@/lib/agents/conversation-reconciler";
import { buildConversationPresentation } from "@/lib/agents/conversation-thread";
import {
  getDaemonSessionOutput,
  getDaemonSessionRuntimeSnapshot,
  streamDaemonSessionRuntimeSnapshots,
} from "@/lib/agents/daemon-client";
import type {
  ConversationPresentationSnapshot,
  ConversationRuntimeSnapshot,
} from "@/types/conversations";

export const runtime = "nodejs";

function buildVersion(snapshot: ConversationPresentationSnapshot): string {
  return JSON.stringify({
    meta: {
      id: snapshot.meta.id,
      status: snapshot.meta.status,
      completedAt: snapshot.meta.completedAt || null,
      summary: snapshot.meta.summary || null,
      contextSummary: snapshot.meta.contextSummary || null,
      proposal: snapshot.meta.agentProposal || null,
      runtimeSession: snapshot.meta.runtimeSession || null,
    },
    mentions: snapshot.mentions,
    artifacts: snapshot.artifacts,
    thread: snapshot.thread,
    transcript: snapshot.transcript,
  });
}

async function loadConversationRecord(id: string): Promise<ConversationReadRecord | null> {
  let record = await readConversationRecord(id);
  if (!record) {
    return null;
  }

  if (record.meta.status === "running") {
    const reconciled = await reconcileRunningConversation(record.meta);
    if (reconciled.status !== record.meta.status) {
      record = await readConversationRecord(id);
    }
  }

  return record;
}

function buildSnapshot(input: {
  record: ConversationReadRecord;
  liveOutput?: string;
  runtimeSnapshot?: ConversationRuntimeSnapshot | null;
}): ConversationPresentationSnapshot {
  const presentation = buildConversationPresentation({
    ...input.record,
    ...(input.liveOutput ? { liveOutput: input.liveOutput } : {}),
    ...(input.runtimeSnapshot ? { runtimeSnapshot: input.runtimeSnapshot } : {}),
  });
  const snapshot: ConversationPresentationSnapshot = {
    ...presentation,
    version: "pending",
    emittedAt: new Date().toISOString(),
  };
  snapshot.version = buildVersion(snapshot);
  return snapshot;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const initialRecord = await loadConversationRecord(id);
  if (!initialRecord) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let closed = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastVersion: string | null = null;
  let lastRuntimeSequence = 0;
  const runtimeAbortController = new AbortController();

  const stream = new ReadableStream({
    async start(controller) {
      const cleanup = () => {
        if (closed) return;
        closed = true;
        runtimeAbortController.abort();
        if (interval) clearInterval(interval);
        if (timeout) clearTimeout(timeout);
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          cleanup();
        }
      };

      const sendSnapshot = (snapshot: ConversationPresentationSnapshot) => {
        if (snapshot.version === lastVersion) {
          return false;
        }
        lastVersion = snapshot.version;
        send("snapshot", snapshot);
        return true;
      };

      const emitFinalPersistedSnapshot = async () => {
        const meta = await readConversationMeta(id);
        if (meta?.status === "running") {
          await reconcileRunningConversation(meta);
        }

        const record = await readConversationRecord(id);
        if (!record) {
          cleanup();
          return;
        }

        sendSnapshot(buildSnapshot({ record }));
        cleanup();
      };

      const pollOnce = async () => {
        if (closed) return;

        try {
          let record = await loadConversationRecord(id);
          if (!record) {
            cleanup();
            return;
          }

          let liveOutput: string | undefined;
          if (record.meta.status === "running") {
            try {
              const live = await getDaemonSessionOutput(id, { timeoutMs: 1500 });
              if (live.status === "running") {
                liveOutput = live.output;
              } else {
                await finalizeConversation(id, {
                  status: live.status === "completed" ? "completed" : "failed",
                  output: live.output,
                  exitCode: live.status === "completed" ? 0 : 1,
                });
                record = await readConversationRecord(id);
                if (!record) {
                  cleanup();
                  return;
                }
              }
            } catch {
              // keep persisted state only
            }
          }

          if (!record) {
            cleanup();
            return;
          }

          const finalRecord = record;
          sendSnapshot(buildSnapshot({
            record: finalRecord,
            ...(liveOutput ? { liveOutput } : {}),
          }));

          if (finalRecord.meta.status !== "running") {
            cleanup();
          }
        } catch {
          // keep stream open; next tick may recover
        }
      };

      const startPollingFallback = async () => {
        await pollOnce();
        if (closed) return;
        interval = setInterval(() => {
          void pollOnce();
        }, 1500);
      };

      const tryStructuredStream = async () => {
        const currentRecord = await loadConversationRecord(id);
        if (
          !currentRecord ||
          currentRecord.meta.status !== "running" ||
          currentRecord.meta.runtimeSession?.eventStreamFormat !== "structured_v1"
        ) {
          return false;
        }

        let runtimeSnapshot: ConversationRuntimeSnapshot;
        try {
          runtimeSnapshot = await getDaemonSessionRuntimeSnapshot(id, {
            timeoutMs: 1500,
          });
        } catch {
          return false;
        }

        lastRuntimeSequence = runtimeSnapshot.sequence;
        sendSnapshot(
          buildSnapshot({
            record: currentRecord,
            runtimeSnapshot,
          })
        );

        if (runtimeSnapshot.status !== "running") {
          await emitFinalPersistedSnapshot();
          return true;
        }

        try {
          for await (const nextRuntimeSnapshot of streamDaemonSessionRuntimeSnapshots(id, {
            signal: runtimeAbortController.signal,
            timeoutMs: null,
          })) {
            if (closed) {
              return true;
            }
            if (nextRuntimeSnapshot.sequence <= lastRuntimeSequence) {
              continue;
            }

            lastRuntimeSequence = nextRuntimeSnapshot.sequence;
            const nextRecord = await readConversationRecord(id);
            if (!nextRecord) {
              cleanup();
              return true;
            }

            sendSnapshot(
              buildSnapshot({
                record: nextRecord,
                runtimeSnapshot: nextRuntimeSnapshot,
              })
            );

            if (nextRuntimeSnapshot.status !== "running") {
              await emitFinalPersistedSnapshot();
              return true;
            }
          }
        } catch {
          if (closed) {
            return true;
          }
        }

        return false;
      };

      controller.enqueue(encoder.encode("retry: 2000\n\n"));
      timeout = setTimeout(cleanup, 5 * 60 * 1000);
      req.signal.addEventListener("abort", cleanup);

      const handledByStructuredStream = await tryStructuredStream();
      if (!handledByStructuredStream && !closed) {
        await startPollingFallback();
      }
    },
    cancel() {
      closed = true;
      runtimeAbortController.abort();
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
