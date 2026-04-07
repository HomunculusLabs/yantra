import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import type {
  ConversationMeta,
  ConversationRuntimeSnapshot,
} from "@/types/conversations";
import type { ConversationReadRecord } from "@/lib/agents/conversation-store";

let conversationRecord: ConversationReadRecord | null = null;
let runtimeSnapshot: ConversationRuntimeSnapshot | null = null;
let runtimeSnapshotStream: ConversationRuntimeSnapshot[] = [];

const finalizeConversation = mock(async () => null);
const readConversationRecord = mock(async () => conversationRecord);
const readConversationMeta = mock(async () => conversationRecord?.meta ?? null);
const reconcileRunningConversation = mock(async (meta: ConversationMeta) => meta);
const reconcileRunningConversations = mock(async (metas: ConversationMeta[]) => metas);
const getDaemonSessionOutput = mock(async () => ({
  status: "running" as const,
  output: [
    "Working...",
    "```yantra",
    "SUMMARY: Building the draft",
    "ARTIFACT: data/notes.md",
    "```",
    "Visible progress line",
  ].join("\n"),
}));
const getDaemonSessionRuntimeSnapshot = mock(async () => {
  if (!runtimeSnapshot) {
    throw new Error("missing runtime snapshot");
  }
  return runtimeSnapshot;
});
const streamDaemonSessionRuntimeSnapshots = mock(async function* () {
  for (const snapshot of runtimeSnapshotStream) {
    yield snapshot;
  }
});

mock.module("@/lib/agents/conversation-store", () => ({
  finalizeConversation,
  readConversationMeta,
  readConversationRecord,
}));

mock.module("@/lib/agents/conversation-reconciler", () => ({
  reconcileRunningConversation,
  reconcileRunningConversations,
}));

mock.module("@/lib/agents/daemon-client", () => ({
  getDaemonSessionOutput,
  getDaemonSessionRuntimeSnapshot,
  streamDaemonSessionRuntimeSnapshots,
  reloadDaemonSchedules: mock(async () => {}),
}));

const { GET } = await import("@/app/api/agents/conversations/[id]/events/route");

function makeMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: "conversation-1",
    agentSlug: "general",
    title: "Conversation",
    trigger: "manual",
    status: "running",
    startedAt: "2026-04-07T12:00:00.000Z",
    promptPath: "prompt.md",
    transcriptPath: "transcript.txt",
    mentionedPaths: [],
    artifactPaths: [],
    runtimeSession: {
      launchTransport: "tmux",
      startedAt: "2026-04-07T12:00:00.000Z",
      tmuxAttachCommand: "tmux attach -t yantra-conversation-1",
    },
    ...overrides,
  };
}

function makeRecord(meta: ConversationMeta): ConversationReadRecord {
  return {
    meta,
    prompt: "User request:\nBuild a draft",
    transcript: "",
    mentions: [],
    artifacts: [],
  };
}

async function readUntilSnapshot(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Expected SSE response body");
  }

  let buffer = "";
  for (let index = 0; index < 5; index += 1) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += new TextDecoder().decode(value);
    if (buffer.includes("event: snapshot")) {
      await reader.cancel();
      return buffer;
    }
  }

  await reader.cancel();
  throw new Error("Did not receive snapshot event");
}

beforeEach(() => {
  conversationRecord = null;
  runtimeSnapshot = null;
  runtimeSnapshotStream = [];
  finalizeConversation.mockClear();
  readConversationMeta.mockClear();
  readConversationRecord.mockClear();
  reconcileRunningConversation.mockClear();
  reconcileRunningConversations.mockClear();
  getDaemonSessionOutput.mockClear();
  getDaemonSessionRuntimeSnapshot.mockClear();
  streamDaemonSessionRuntimeSnapshots.mockClear();
});

describe("/api/agents/conversations/[id]/events", () => {
  test("emits transcript-adapter snapshots for legacy running conversations", async () => {
    conversationRecord = makeRecord(makeMeta());

    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: "conversation-1" }),
    });

    expect(response.status).toBe(200);

    const chunk = await readUntilSnapshot(response);
    const snapshotLine = chunk
      .split("\n")
      .find((line) => line.startsWith("data: "));

    if (!snapshotLine) {
      throw new Error("Expected SSE data line");
    }

    const snapshot = JSON.parse(snapshotLine.slice("data: ".length));

    expect(snapshot.thread.source).toBe("transcript_adapter");
    expect(snapshot.thread.items).toEqual([
      {
        id: "user:conversation-1",
        kind: "user",
        text: "Build a draft",
        mentionedPaths: [],
      },
      {
        id: "system:runtime_session:conversation-1",
        kind: "system",
        systemType: "runtime_session",
        title: "Session started in tmux",
        description: "Runtime attached via tmux.",
        command: "tmux attach -t yantra-conversation-1",
        tone: "neutral",
      },
    ]);
    expect(snapshot.thread.streamingItem).toEqual({
      id: "assistant:conversation-1:streaming",
      kind: "assistant",
      state: "streaming",
      summary: "Building the draft",
      parts: [
        {
          kind: "markdown",
          id: "assistant:conversation-1:streaming:markdown",
          text: "Visible progress line",
        },
        {
          kind: "artifact_list",
          id: "assistant:conversation-1:streaming:artifacts",
          artifacts: [{ path: "data/notes.md" }],
        },
      ],
    });
  });

  test("prefers structured runtime snapshots for structured-capable conversations", async () => {
    conversationRecord = makeRecord(
      makeMeta({
        runtimeSession: {
          launchTransport: "tmux",
          startedAt: "2026-04-07T12:00:00.000Z",
          tmuxAttachCommand: "tmux attach -t yantra-conversation-1",
          eventStreamFormat: "structured_v1",
        },
      })
    );
    runtimeSnapshot = {
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
        summary: "Building the draft",
        parts: [
          {
            kind: "status",
            id: "runtime:conversation-1:status",
            label: "Live update",
            tone: "neutral",
            detail: "Live tmux session.",
          },
          {
            kind: "markdown",
            id: "runtime:conversation-1:markdown",
            text: "Visible progress line",
          },
          {
            kind: "context",
            id: "runtime:conversation-1:context",
            text: "Using the referenced note.",
          },
          {
            kind: "artifact_list",
            id: "runtime:conversation-1:artifacts",
            artifacts: [{ path: "data/notes.md" }],
          },
          {
            kind: "tool_call",
            id: "runtime:conversation-1:agent_proposal",
            toolName: "Agent draft",
            state: "pending",
            inputSummary: "Preparing a proposed Yantra agent draft.",
            outputSummary: "Builder (builder)",
          },
        ],
      },
    };
    runtimeSnapshotStream = [runtimeSnapshot];

    const response = await GET(new NextRequest("http://localhost"), {
      params: Promise.resolve({ id: "conversation-1" }),
    });

    expect(response.status).toBe(200);

    const chunk = await readUntilSnapshot(response);
    const snapshotLine = chunk
      .split("\n")
      .find((line) => line.startsWith("data: "));

    if (!snapshotLine) {
      throw new Error("Expected SSE data line");
    }

    const snapshot = JSON.parse(snapshotLine.slice("data: ".length));

    expect(snapshot.thread.source).toBe("structured_session");
    expect(snapshot.thread.items).toEqual([
      {
        id: "user:conversation-1",
        kind: "user",
        text: "Build a draft",
        mentionedPaths: [],
      },
      {
        id: "system:runtime_session:conversation-1",
        kind: "system",
        systemType: "runtime_session",
        title: "Session started in tmux",
        description: "Runtime attached via tmux.",
        command: "tmux attach -t yantra-conversation-1",
        tone: "neutral",
      },
    ]);
    expect(snapshot.thread.streamingItem).toEqual({
      id: "assistant:conversation-1:streaming",
      kind: "assistant",
      state: "streaming",
      summary: "Building the draft",
      parts: [
        {
          kind: "status",
          id: "runtime:conversation-1:status",
          label: "Live update",
          tone: "neutral",
          detail: "Live tmux session.",
        },
        {
          kind: "markdown",
          id: "runtime:conversation-1:markdown",
          text: "Visible progress line",
        },
        {
          kind: "context",
          id: "runtime:conversation-1:context",
          text: "Using the referenced note.",
        },
        {
          kind: "artifact_list",
          id: "runtime:conversation-1:artifacts",
          artifacts: [{ path: "data/notes.md" }],
        },
        {
          kind: "tool_call",
          id: "runtime:conversation-1:agent_proposal",
          toolName: "Agent draft",
          state: "pending",
          inputSummary: "Preparing a proposed Yantra agent draft.",
          outputSummary: "Builder (builder)",
        },
      ],
    });
    expect(getDaemonSessionOutput.mock.calls.length).toBe(0);
    expect(getDaemonSessionRuntimeSnapshot.mock.calls.length).toBe(1);
  });
});
