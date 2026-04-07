import { describe, expect, test } from "bun:test";
import type {
  ConversationMeta,
  ConversationRuntimeSnapshot,
} from "@/types/conversations";
import { buildConversationPresentation } from "@/lib/agents/conversation-thread";

function baseMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: "conversation-1",
    agentSlug: "general",
    title: "Fallback title",
    trigger: "manual",
    status: "completed",
    startedAt: "2026-04-07T12:00:00.000Z",
    promptPath: "@runtime/.agents/.conversations/conversation-1/prompt.md",
    transcriptPath: "@runtime/.agents/.conversations/conversation-1/transcript.txt",
    mentionedPaths: [],
    artifactPaths: [],
    ...overrides,
  };
}

function makeRuntimeSnapshot(
  overrides: Partial<ConversationRuntimeSnapshot> = {}
): ConversationRuntimeSnapshot {
  return {
    sessionId: "conversation-1",
    sequence: 1,
    updatedAt: "2026-04-07T12:01:00.000Z",
    status: "running",
    runtimeSession: {
      launchTransport: "tmux",
      startedAt: "2026-04-07T12:00:00.000Z",
      tmuxAttachCommand: "tmux attach -t yantra-agent-foundry",
      eventStreamFormat: "structured_v1",
    },
    assistant: {
      summary: "Building the draft",
      body: "Visible progress line",
      contextSummary: "Using the referenced note.",
      artifacts: [{ path: "data/notes.md" }],
    },
    ...overrides,
  };
}

describe("buildConversationPresentation", () => {
  test("falls back to prompt parsing for the user bubble when userMessage is missing", () => {
    const presentation = buildConversationPresentation({
      meta: baseMeta(),
      prompt: [
        "You are an agent.",
        "",
        "User request:",
        "Write a project update.",
        "",
        "Referenced pages:",
        "Project.md",
      ].join("\n"),
      transcript: "Completed the update.",
      mentions: ["Project.md"],
      artifacts: [],
    });

    expect(presentation.thread.source).toBe("transcript_adapter");
    expect(presentation.thread.items[0]).toEqual({
      id: "user:conversation-1",
      kind: "user",
      text: "Write a project update.",
      mentionedPaths: ["Project.md"],
    });
  });

  test("keeps running conversations focused on the live assistant update", () => {
    const presentation = buildConversationPresentation({
      meta: baseMeta({
        status: "running",
        userMessage: "Make me a new agent",
        runtimeSession: {
          launchTransport: "tmux",
          startedAt: "2026-04-07T12:00:00.000Z",
          tmuxSessionName: "yantra-agent-foundry",
          tmuxAttachCommand: "tmux attach -t yantra-agent-foundry",
        },
      }),
      prompt: "User request:\nMake me a new agent",
      transcript: "",
      mentions: [],
      artifacts: [],
      liveOutput: [
        "Thinking...",
        "```yantra",
        "SUMMARY: Building the draft",
        "ARTIFACT: data/notes.md",
        "```",
        "```yantra-create-agent",
        JSON.stringify({ name: "Builder", role: "Builds drafts" }, null, 2),
        "```",
        "Visible progress line",
      ].join("\n"),
    });

    expect(presentation.thread.source).toBe("transcript_adapter");
    expect(presentation.thread.items).toEqual([
      {
        id: "user:conversation-1",
        kind: "user",
        text: "Make me a new agent",
        mentionedPaths: [],
      },
      {
        id: "system:runtime_session:conversation-1",
        kind: "system",
        systemType: "runtime_session",
        title: "Session started in tmux",
        description: "Runtime attached via tmux.",
        command: "tmux attach -t yantra-agent-foundry",
        tone: "neutral",
      },
    ]);
    expect(presentation.thread.streamingItem).toEqual({
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

  test("defers malformed live agent drafts until the run finishes", () => {
    const presentation = buildConversationPresentation({
      meta: baseMeta({
        status: "running",
        userMessage: "Make me a new agent",
        runtimeSession: {
          launchTransport: "direct",
          startedAt: "2026-04-07T12:00:00.000Z",
        },
      }),
      prompt: "User request:\nMake me a new agent",
      transcript: "",
      mentions: [],
      artifacts: [],
      liveOutput: [
        "Visible progress line",
        "```yantra-create-agent",
        '{"name":"Broken Agent","role":"Broken"',
        "```",
      ].join("\n"),
    });

    expect(presentation.thread.items).toEqual([
      {
        id: "user:conversation-1",
        kind: "user",
        text: "Make me a new agent",
        mentionedPaths: [],
      },
      {
        id: "system:runtime_session:conversation-1",
        kind: "system",
        systemType: "runtime_session",
        title: "Session started",
        description: "Runtime attached via direct.",
        tone: "neutral",
      },
    ]);
    expect(presentation.thread.streamingItem?.summary).toBe("Visible progress line");
  });

  test("uses transcript fallback summary and parts for completed conversations", () => {
    const presentation = buildConversationPresentation({
      meta: baseMeta({
        status: "completed",
        userMessage: "Summarize this run",
        agentProposal: { status: "pending", draft: null, issues: [] },
        runtimeSession: {
          launchTransport: "tmux",
          startedAt: "2026-04-07T12:00:00.000Z",
          tmuxAttachCommand: "tmux attach -t yantra-agent-foundry",
          exitCode: 0,
          exitedAt: "2026-04-07T12:05:00.000Z",
        },
      }),
      prompt: "User request:\nSummarize this run",
      transcript: [
        "First useful line",
        "Second line of detail",
        "Third line of detail",
      ].join("\n"),
      mentions: [],
      artifacts: [{ path: "Artifacts/report.md" }],
    });

    expect(presentation.thread.items[1]).toEqual({
      id: "system:runtime_session:conversation-1",
      kind: "system",
      systemType: "runtime_session",
      title: "Session started in tmux",
      description: "Run completed with exit code 0.",
      command: "tmux attach -t yantra-agent-foundry",
      tone: "success",
    });
    expect(presentation.thread.items[2]).toEqual({
      id: "assistant:conversation-1",
      kind: "assistant",
      state: "completed",
      summary: "First useful line",
      parts: [
        {
          kind: "markdown",
          id: "assistant:conversation-1:markdown",
          text: [
            "First useful line",
            "Second line of detail",
            "Third line of detail",
          ].join("\n"),
        },
        {
          kind: "artifact_list",
          id: "assistant:conversation-1:artifacts",
          artifacts: [{ path: "Artifacts/report.md" }],
        },
      ],
    });
    expect(presentation.thread.items[3]).toEqual({
      id: "action:agent_proposal:conversation-1",
      kind: "action",
      actionType: "agent_proposal",
      sourceConversationId: "conversation-1",
      proposal: { status: "pending", draft: null, issues: [] },
    });
  });

  test("distinguishes cancelled runs from failed runs", () => {
    const presentation = buildConversationPresentation({
      meta: baseMeta({
        status: "cancelled",
        userMessage: "Stop this run",
      }),
      prompt: "User request:\nStop this run",
      transcript: "",
      mentions: [],
      artifacts: [],
    });

    expect(presentation.thread.items[1]).toEqual({
      id: "assistant:conversation-1",
      kind: "assistant",
      state: "cancelled",
      summary: "Run cancelled.",
      parts: [],
    });
  });

  test("prefers structured runtime snapshots for new running conversations", () => {
    const presentation = buildConversationPresentation({
      meta: baseMeta({
        status: "running",
        userMessage: "Build a draft",
        runtimeSession: {
          launchTransport: "tmux",
          startedAt: "2026-04-07T12:00:00.000Z",
          tmuxAttachCommand: "tmux attach -t yantra-agent-foundry",
          eventStreamFormat: "structured_v1",
        },
      }),
      prompt: "User request:\nBuild a draft",
      transcript: "persisted transcript",
      mentions: [],
      artifacts: [],
      runtimeSnapshot: makeRuntimeSnapshot(),
    });

    expect(presentation.thread.source).toBe("structured_session");
    expect(presentation.thread.items).toEqual([
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
        command: "tmux attach -t yantra-agent-foundry",
        tone: "neutral",
      },
    ]);
    expect(presentation.thread.streamingItem).toEqual({
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
          kind: "context",
          id: "assistant:conversation-1:streaming:context",
          text: "Using the referenced note.",
        },
        {
          kind: "artifact_list",
          id: "assistant:conversation-1:streaming:artifacts",
          artifacts: [{ path: "data/notes.md" }],
        },
      ],
    });
    expect(presentation.meta.summary).toBe("Building the draft");
    expect(presentation.meta.contextSummary).toBe("Using the referenced note.");
    expect(presentation.artifacts).toEqual([{ path: "data/notes.md" }]);
  });

  test("commits structured assistant items once a structured runtime session completes", () => {
    const presentation = buildConversationPresentation({
      meta: baseMeta({
        status: "running",
        userMessage: "Build a draft",
        runtimeSession: {
          launchTransport: "direct",
          startedAt: "2026-04-07T12:00:00.000Z",
          eventStreamFormat: "structured_v1",
        },
      }),
      prompt: "User request:\nBuild a draft",
      transcript: "persisted transcript",
      mentions: [],
      artifacts: [],
      runtimeSnapshot: makeRuntimeSnapshot({
        status: "completed",
        runtimeSession: {
          launchTransport: "direct",
          startedAt: "2026-04-07T12:00:00.000Z",
          exitedAt: "2026-04-07T12:05:00.000Z",
          exitCode: 0,
          eventStreamFormat: "structured_v1",
        },
        assistant: {
          summary: "Draft created",
          body: "Created the librarian draft.",
          artifacts: [{ path: "data/agents/librarian.md" }],
        },
      }),
    });

    expect(presentation.thread.source).toBe("structured_session");
    expect(presentation.thread.streamingItem).toBeUndefined();
    expect(presentation.thread.items[2]).toEqual({
      id: "assistant:conversation-1",
      kind: "assistant",
      state: "completed",
      summary: "Draft created",
      parts: [
        {
          kind: "markdown",
          id: "assistant:conversation-1:markdown",
          text: "Created the librarian draft.",
        },
        {
          kind: "artifact_list",
          id: "assistant:conversation-1:artifacts",
          artifacts: [{ path: "data/agents/librarian.md" }],
        },
      ],
    });
  });
});
