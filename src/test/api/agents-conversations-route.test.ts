import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import type { ConversationMeta, ConversationRuntimeSnapshot } from "@/types/conversations";

let listedConversations: ConversationMeta[] = [];
let reconciledConversations: ConversationMeta[] = [];
let daemonRuntimeSnapshot: ConversationRuntimeSnapshot | null = null;

const listConversationMetas = mock(async () => listedConversations);
const reconcileRunningConversations = mock(async () => reconciledConversations);
const reconcileRunningConversation = mock(async (meta: ConversationMeta) => meta);
const getDaemonSessionRuntimeSnapshot = mock(async () => {
  if (!daemonRuntimeSnapshot) {
    throw new Error("missing runtime snapshot");
  }
  return daemonRuntimeSnapshot;
});

const buildManualConversationPrompt = mock(async () => ({
  prompt: "prompt",
  title: "title",
  cwd: undefined,
}));
const buildEditorConversationPrompt = mock(async () => ({
  prompt: "prompt",
  title: "title",
  cwd: undefined,
  mentionedPaths: [],
}));
const startConversationRun = mock(async () => null);
const listPersonas = mock(async () => []);
const readPersona = mock(async () => null);
const writePersona = mock(async () => undefined);
const readMemory = mock(async () => "");
const writeMemory = mock(async () => undefined);

mock.module("@/lib/agents/conversation-store", () => ({
  listConversationMetas,
}));

mock.module("@/lib/agents/conversation-reconciler", () => ({
  reconcileRunningConversation,
  reconcileRunningConversations,
}));

mock.module("@/lib/agents/daemon-client", () => ({
  getDaemonSessionRuntimeSnapshot,
}));

mock.module("@/lib/agents/conversation-runner", () => ({
  buildEditorConversationPrompt,
  buildManualConversationPrompt,
  startConversationRun,
}));

mock.module("@/lib/agents/persona-manager", () => ({
  listPersonas,
  readPersona,
  readMemory,
  writePersona,
  writeMemory,
}));

const { GET } = await import("@/app/api/agents/conversations/route");

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
      eventStreamFormat: "structured_v1",
    },
    ...overrides,
  };
}

beforeEach(() => {
  listedConversations = [];
  reconciledConversations = [];
  daemonRuntimeSnapshot = null;

  listConversationMetas.mockClear();
  reconcileRunningConversations.mockClear();
  reconcileRunningConversation.mockClear();
  getDaemonSessionRuntimeSnapshot.mockClear();
  buildManualConversationPrompt.mockClear();
  buildEditorConversationPrompt.mockClear();
  startConversationRun.mockClear();
  listPersonas.mockClear();
  readPersona.mockClear();
  readMemory.mockClear();
  writePersona.mockClear();
  writeMemory.mockClear();
});

describe("/api/agents/conversations", () => {
  test("GET overlays structured live metadata for running structured conversations", async () => {
    const baseConversation = makeMeta();
    listedConversations = [baseConversation];
    reconciledConversations = [baseConversation];
    daemonRuntimeSnapshot = {
      sessionId: baseConversation.id,
      sequence: 2,
      updatedAt: "2026-04-07T12:01:00.000Z",
      status: "running",
      runtimeSession: {
        launchTransport: "tmux",
        startedAt: "2026-04-07T12:00:00.000Z",
        tmuxAttachCommand: "tmux attach -t yantra-conversation-1",
        eventStreamFormat: "structured_v1",
      },
      assistant: {
        summary: "Indexing the vault",
        parts: [
          {
            kind: "status",
            id: "runtime:conversation-1:status",
            label: "Live update",
            tone: "neutral",
            detail: "Live tmux session.",
          },
          {
            kind: "artifact_list",
            id: "runtime:conversation-1:artifacts",
            artifacts: [{ path: "data/notes.md" }],
          },
        ],
      },
    };

    const response = await GET(
      new NextRequest("http://localhost/api/agents/conversations?limit=20")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0]).toMatchObject({
      id: baseConversation.id,
      status: "running",
      summary: "Indexing the vault",
      artifactPaths: ["data/notes.md"],
      runtimeSession: {
        eventStreamFormat: "structured_v1",
        launchTransport: "tmux",
      },
    });
    expect(getDaemonSessionRuntimeSnapshot.mock.calls.length).toBe(1);
  });

  test("GET falls back to reconciled metadata when the runtime snapshot is unavailable", async () => {
    const baseConversation = makeMeta({ summary: "Persisted summary" });
    listedConversations = [baseConversation];
    reconciledConversations = [baseConversation];
    daemonRuntimeSnapshot = null;

    const response = await GET(
      new NextRequest("http://localhost/api/agents/conversations?limit=20")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.conversations[0].summary).toBe("Persisted summary");
    expect(getDaemonSessionRuntimeSnapshot.mock.calls.length).toBe(1);
  });
});
