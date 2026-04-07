import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import type {
  ConversationDetail,
  ConversationMeta,
  ConversationRuntimeSnapshot,
} from "@/types/conversations";
import type { ConversationReadRecord } from "@/lib/agents/conversation-store";

let conversationMeta: ConversationMeta | null = null;
let conversationDetail: ConversationDetail | null = null;
let conversationRecord: ConversationReadRecord | null = null;
let declineResult: ConversationMeta | null = null;
let restoreResult: ConversationMeta | null = null;
let daemonRuntimeSnapshot: ConversationRuntimeSnapshot | null = null;

const readConversationMeta = mock(async () => conversationMeta);
const readConversationDetail = mock(async () => conversationDetail);
const readConversationRecord = mock(async () => conversationRecord);
const declineConversationAgentProposal = mock(async () => declineResult);
const restoreConversationAgentProposal = mock(async () => restoreResult);
const reconcileRunningConversation = mock(async (meta: ConversationMeta) => meta);
const getDaemonSessionRuntimeSnapshot = mock(async () => {
  if (!daemonRuntimeSnapshot) {
    throw new Error("missing runtime snapshot");
  }
  return daemonRuntimeSnapshot;
});
const getDaemonSessionOutput = mock(async () => ({
  status: "running" as const,
  output: "",
}));
const streamDaemonSessionRuntimeSnapshots = mock(async function* () {});
const reloadDaemonSchedules = mock(async () => {});

mock.module("@/lib/agents/conversation-store", () => ({
  declineConversationAgentProposal,
  readConversationDetail,
  readConversationMeta,
  readConversationRecord,
  restoreConversationAgentProposal,
}));

mock.module("@/lib/agents/conversation-reconciler", () => ({
  reconcileRunningConversation,
}));

mock.module("@/lib/agents/daemon-client", () => ({
  getDaemonSessionOutput,
  getDaemonSessionRuntimeSnapshot,
  reloadDaemonSchedules,
  streamDaemonSessionRuntimeSnapshots,
}));

const { GET, PATCH } = await import("@/app/api/agents/conversations/[id]/route");

function makeMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: "conversation-1",
    agentSlug: "general",
    title: "Conversation",
    trigger: "manual",
    status: "completed",
    startedAt: "2026-04-07T12:00:00.000Z",
    promptPath: "prompt.md",
    transcriptPath: "transcript.txt",
    mentionedPaths: [],
    artifactPaths: [],
    ...overrides,
  };
}

function makeDetail(meta: ConversationMeta): ConversationDetail {
  return {
    meta,
    prompt: "User request:\nHello",
    transcript: "Hello",
    mentions: [],
    artifacts: [],
    thread: {
      source: "transcript_adapter",
      items: [
        { kind: "user", id: "user:1", text: "Hello", mentionedPaths: [] },
        {
          kind: "assistant",
          id: "assistant:1",
          state: "completed",
          summary: "Hello",
          parts: [],
        },
      ],
    },
  };
}

function makeRecord(meta: ConversationMeta): ConversationReadRecord {
  return {
    meta,
    prompt: "User request:\nHello",
    transcript: "Hello",
    mentions: [],
    artifacts: [],
  };
}

beforeEach(() => {
  conversationMeta = null;
  conversationDetail = null;
  conversationRecord = null;
  declineResult = null;
  restoreResult = null;
  daemonRuntimeSnapshot = null;

  readConversationMeta.mockClear();
  readConversationDetail.mockClear();
  readConversationRecord.mockClear();
  declineConversationAgentProposal.mockClear();
  restoreConversationAgentProposal.mockClear();
  reconcileRunningConversation.mockClear();
  getDaemonSessionOutput.mockClear();
  getDaemonSessionRuntimeSnapshot.mockClear();
  reloadDaemonSchedules.mockClear();
  streamDaemonSessionRuntimeSnapshots.mockClear();
});

describe("/api/agents/conversations/[id]", () => {
  test("GET returns 404 when the conversation is missing", async () => {
    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: "conversation-1" }),
    });

    expect(response.status).toBe(404);
  });

  test("GET reconciles running conversations before returning detail", async () => {
    conversationMeta = makeMeta({ status: "running" });
    conversationRecord = makeRecord(conversationMeta);
    conversationDetail = makeDetail(conversationMeta);

    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: conversationMeta.id }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(reconcileRunningConversation.mock.calls.length).toBe(1);
    expect(body.meta.id).toBe(conversationMeta.id);
  });

  test("GET prefers structured runtime snapshots for structured-capable running conversations", async () => {
    conversationMeta = makeMeta({
      status: "running",
      userMessage: "Hello",
      runtimeSession: {
        launchTransport: "tmux",
        startedAt: "2026-04-07T12:00:00.000Z",
        tmuxAttachCommand: "tmux attach -t yantra-conversation-1",
        eventStreamFormat: "structured_v1",
      },
    });
    conversationRecord = makeRecord(conversationMeta);
    daemonRuntimeSnapshot = {
      sessionId: "conversation-1",
      sequence: 1,
      updatedAt: "2026-04-07T12:01:00.000Z",
      status: "running",
      runtimeSession: {
        launchTransport: "tmux",
        startedAt: "2026-04-07T12:00:00.000Z",
        tmuxAttachCommand: "tmux attach -t yantra-conversation-1",
        eventStreamFormat: "structured_v1",
      },
      assistant: {
        summary: "Working on it",
        body: "Visible progress line",
        artifacts: [{ path: "data/notes.md" }],
      },
    };

    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: conversationMeta.id }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.thread.source).toBe("structured_session");
    expect(body.thread.streamingItem.summary).toBe("Working on it");
    expect(body.meta.runtimeSession.eventStreamFormat).toBe("structured_v1");
  });

  test("GET falls back to persisted detail when the runtime snapshot fetch fails", async () => {
    conversationMeta = makeMeta({
      status: "running",
      runtimeSession: {
        launchTransport: "direct",
        startedAt: "2026-04-07T12:00:00.000Z",
        eventStreamFormat: "structured_v1",
      },
    });
    conversationRecord = makeRecord(conversationMeta);
    conversationDetail = makeDetail(conversationMeta);
    daemonRuntimeSnapshot = null;

    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: conversationMeta.id }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.thread.source).toBe("transcript_adapter");
    expect(readConversationDetail.mock.calls.length).toBe(1);
  });

  test("PATCH declines a pending proposal and returns the updated detail", async () => {
    conversationMeta = makeMeta({
      agentProposal: { status: "pending", draft: null, issues: [] },
    });
    declineResult = makeMeta({
      ...conversationMeta,
      agentProposal: {
        status: "declined",
        draft: null,
        issues: [],
        declinedAt: "2026-04-07T12:15:00.000Z",
      },
    });
    conversationDetail = makeDetail(declineResult);

    const response = await PATCH(
      new NextRequest("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "decline_agent_proposal" }),
      }),
      { params: Promise.resolve({ id: conversationMeta.id }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(declineConversationAgentProposal.mock.calls.length).toBe(1);
    expect(body.meta.agentProposal.status).toBe("declined");
  });

  test("PATCH returns 409 when a pending decline races and no longer applies", async () => {
    conversationMeta = makeMeta({
      agentProposal: { status: "pending", draft: null, issues: [] },
    });
    declineResult = null;

    const response = await PATCH(
      new NextRequest("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "decline_agent_proposal" }),
      }),
      { params: Promise.resolve({ id: conversationMeta.id }) }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: "Source conversation proposal is no longer pending" });
  });

  test("PATCH restores a declined proposal", async () => {
    conversationMeta = makeMeta({
      agentProposal: {
        status: "declined",
        draft: null,
        issues: [],
        declinedAt: "2026-04-07T12:15:00.000Z",
      },
    });
    restoreResult = makeMeta({
      ...conversationMeta,
      agentProposal: { status: "pending", draft: null, issues: [] },
    });
    conversationDetail = makeDetail(restoreResult);

    const response = await PATCH(
      new NextRequest("http://localhost", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "restore_agent_proposal" }),
      }),
      { params: Promise.resolve({ id: conversationMeta.id }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(restoreConversationAgentProposal.mock.calls.length).toBe(1);
    expect(body.meta.agentProposal.status).toBe("pending");
  });
});
