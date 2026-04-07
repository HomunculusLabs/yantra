import type {
  ConversationActionThreadItem,
  ConversationArtifact,
  ConversationAssistantPart,
  ConversationAssistantState,
  ConversationAssistantThreadItem,
  ConversationMeta,
  ConversationPresentation,
  ConversationRuntimeSession,
  ConversationRuntimeSnapshot,
  ConversationSystemThreadItem,
  ConversationThread,
  ConversationThreadItem,
} from "@/types/conversations";
import {
  buildLiveOutputExcerpt,
  extractConversationRequestFromPrompt,
  makeSummaryFromOutput,
  parseYantraBlock,
  stripYantraPresentationBlocks,
} from "./conversation-output-parser";
import { sanitizeTranscriptInline } from "./transcript-format";

interface BuildConversationPresentationInput {
  meta: ConversationMeta;
  prompt: string;
  transcript: string;
  mentions: string[];
  artifacts: ConversationArtifact[];
  liveOutput?: string;
  structuredThread?: ConversationThread | null;
  runtimeSnapshot?: ConversationRuntimeSnapshot | null;
}

function makeAssistantItemId(meta: ConversationMeta): string {
  return `assistant:${meta.id}`;
}

function makeUserItem(meta: ConversationMeta, prompt: string, mentions: string[]) {
  const userText =
    meta.userMessage ||
    extractConversationRequestFromPrompt(prompt, meta.trigger) ||
    meta.title;

  return {
    kind: "user" as const,
    id: `user:${meta.id}`,
    text: userText,
    mentionedPaths: mentions,
    ...(meta.pagePath ? { pagePath: meta.pagePath } : {}),
  };
}

function buildAssistantParts(input: {
  body?: string;
  contextSummary?: string;
  artifacts: ConversationArtifact[];
  itemId: string;
}): ConversationAssistantPart[] {
  const parts: ConversationAssistantPart[] = [];

  if (input.body) {
    parts.push({
      kind: "markdown",
      id: `${input.itemId}:markdown`,
      text: input.body,
    });
  }

  if (input.contextSummary) {
    parts.push({
      kind: "context",
      id: `${input.itemId}:context`,
      text: input.contextSummary,
    });
  }

  if (input.artifacts.length > 0) {
    parts.push({
      kind: "artifact_list",
      id: `${input.itemId}:artifacts`,
      artifacts: input.artifacts,
    });
  }

  return parts;
}

function collectArtifactsFromAssistantParts(
  parts: ConversationAssistantPart[]
): ConversationArtifact[] {
  return parts.flatMap((part) =>
    part.kind === "artifact_list" ? part.artifacts : []
  );
}

function findContextSummaryInAssistantParts(
  parts: ConversationAssistantPart[]
): string | undefined {
  return parts.find((part) => part.kind === "context")?.text;
}

export function overlayConversationMetaWithRuntimeSnapshot(
  meta: ConversationMeta,
  runtimeSnapshot: ConversationRuntimeSnapshot
): ConversationMeta {
  return {
    ...meta,
    status: runtimeSnapshot.status,
    summary: runtimeSnapshot.assistant.summary || meta.summary || undefined,
    contextSummary:
      findContextSummaryInAssistantParts(runtimeSnapshot.assistant.parts) ||
      meta.contextSummary,
    artifactPaths: collectArtifactsFromAssistantParts(
      runtimeSnapshot.assistant.parts
    ).map((artifact) => artifact.path),
    runtimeSession: runtimeSnapshot.runtimeSession,
  };
}

function makeAssistantBody(output: string): string | undefined {
  const stripped = stripYantraPresentationBlocks(output);
  const excerpt = stripped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n");

  return excerpt || undefined;
}

function makeTerminalSummary(meta: ConversationMeta, transcript: string): string {
  const transcriptSummary = makeSummaryFromOutput(transcript);
  if (transcriptSummary) return transcriptSummary;
  if (meta.status === "failed") return "Run failed.";
  if (meta.status === "cancelled") return "Run cancelled.";
  return "Completed.";
}

function mapAssistantState(status: ConversationMeta["status"]): ConversationAssistantState {
  if (status === "running") return "streaming";
  if (status === "failed") return "failed";
  if (status === "cancelled") return "cancelled";
  return "completed";
}

function makeRuntimeSessionItem(
  input:
    | ConversationMeta
    | {
        id: string;
        status: ConversationMeta["status"];
        runtimeSession?: ConversationRuntimeSession;
      }
): ConversationSystemThreadItem | undefined {
  if (!input.runtimeSession) return undefined;

  const title =
    input.runtimeSession.launchTransport === "tmux"
      ? "Session started in tmux"
      : "Session started";
  const description =
    input.status === "running"
      ? `Runtime attached via ${input.runtimeSession.launchTransport}.`
      : input.status === "completed"
        ? `Run completed${input.runtimeSession.exitCode != null ? ` with exit code ${input.runtimeSession.exitCode}.` : "."}`
        : input.status === "cancelled"
          ? "Run was cancelled before completion."
          : `Run failed${input.runtimeSession.exitCode != null ? ` with exit code ${input.runtimeSession.exitCode}.` : "."}`;

  return {
    kind: "system",
    id: `system:runtime_session:${input.id}`,
    systemType: "runtime_session",
    title,
    description,
    command: input.runtimeSession.tmuxAttachCommand,
    tone:
      input.status === "running"
        ? "neutral"
        : input.status === "completed"
          ? "success"
          : input.status === "cancelled"
            ? "warning"
            : "error",
  };
}

function makeRuntimeSnapshotSummary(snapshot: ConversationRuntimeSnapshot): string {
  if (snapshot.assistant.summary) return snapshot.assistant.summary;
  if (snapshot.status === "running") return "Working…";
  if (snapshot.status === "cancelled") return "Run cancelled.";
  if (snapshot.status === "failed") return "Run failed.";
  return "Completed.";
}

function buildStructuredSessionThread(
  input: BuildConversationPresentationInput,
  runtimeSnapshot: ConversationRuntimeSnapshot
): ConversationThread {
  const items: ConversationThreadItem[] = [
    makeUserItem(input.meta, input.prompt, input.mentions),
  ];
  const runtimeSessionItem = makeRuntimeSessionItem({
    id: input.meta.id,
    status: runtimeSnapshot.status,
    runtimeSession: runtimeSnapshot.runtimeSession,
  });
  if (runtimeSessionItem) {
    items.push(runtimeSessionItem);
  }

  const assistantState = mapAssistantState(runtimeSnapshot.status);
  const itemId =
    runtimeSnapshot.status === "running"
      ? `${makeAssistantItemId(input.meta)}:streaming`
      : makeAssistantItemId(input.meta);
  const assistantItem: ConversationAssistantThreadItem = {
    kind: "assistant",
    id: itemId,
    state: assistantState,
    summary: makeRuntimeSnapshotSummary(runtimeSnapshot),
    parts: runtimeSnapshot.assistant.parts,
  };

  if (runtimeSnapshot.status === "running") {
    return {
      source: "structured_session",
      items,
      streamingItem: assistantItem,
    };
  }

  items.push(assistantItem);

  if (input.meta.agentProposal) {
    items.push({
      kind: "action",
      id: `action:agent_proposal:${input.meta.id}`,
      actionType: "agent_proposal",
      sourceConversationId: input.meta.id,
      proposal: input.meta.agentProposal,
    });
  }

  return {
    source: "structured_session",
    items,
  };
}

function buildTranscriptAdapterThread(
  input: BuildConversationPresentationInput
): ConversationThread {
  const items: ConversationThreadItem[] = [
    makeUserItem(input.meta, input.prompt, input.mentions),
  ];
  const runtimeSessionItem = makeRuntimeSessionItem(input.meta);
  if (runtimeSessionItem) {
    items.push(runtimeSessionItem);
  }

  let streamingItem: ConversationAssistantThreadItem | undefined;
  const liveParsed = input.liveOutput
    ? parseYantraBlock(input.liveOutput)
    : { artifactPaths: [] };

  if (input.meta.status === "running") {
    const liveExcerpt = input.liveOutput
      ? buildLiveOutputExcerpt(input.liveOutput)
      : undefined;
    const excerptLines = liveExcerpt
      ? liveExcerpt.split("\n").map((line) => line.trim()).filter(Boolean)
      : [];
    const summary = liveParsed.summary || excerptLines[0] || "Working…";
    const body = liveParsed.summary
      ? liveExcerpt
      : excerptLines.length > 1
        ? excerptLines.slice(1).join("\n")
        : undefined;
    const itemId = `${makeAssistantItemId(input.meta)}:streaming`;

    streamingItem = {
      kind: "assistant",
      id: itemId,
      state: "streaming",
      summary,
      parts: buildAssistantParts({
        itemId,
        body,
        contextSummary: liveParsed.contextSummary,
        artifacts: liveParsed.artifactPaths.map((artifactPath) => ({
          path: artifactPath,
        })),
      }),
    };
  } else {
    const itemId = makeAssistantItemId(input.meta);
    const summary =
      input.meta.summary || makeTerminalSummary(input.meta, input.transcript);

    items.push({
      kind: "assistant",
      id: itemId,
      state: mapAssistantState(input.meta.status),
      summary,
      parts: buildAssistantParts({
        itemId,
        body:
          !summary || summary.length < 40
            ? makeAssistantBody(input.transcript)
            : undefined,
        contextSummary: input.meta.contextSummary,
        artifacts: input.artifacts,
      }),
    });
  }

  if (input.meta.agentProposal) {
    const actionItem: ConversationActionThreadItem = {
      kind: "action",
      id: `action:agent_proposal:${input.meta.id}`,
      actionType: "agent_proposal",
      sourceConversationId: input.meta.id,
      proposal: input.meta.agentProposal,
    };
    items.push(actionItem);
  }

  return {
    source: "transcript_adapter",
    items,
    ...(streamingItem ? { streamingItem } : {}),
  };
}

export function buildConversationPresentation(
  input: BuildConversationPresentationInput
): ConversationPresentation {
  const thread =
    input.structuredThread ||
    (input.runtimeSnapshot
      ? buildStructuredSessionThread(input, input.runtimeSnapshot)
      : buildTranscriptAdapterThread(input));
  const liveSummary =
    input.meta.status === "running" && input.liveOutput
      ? parseYantraBlock(input.liveOutput).summary
      : "";
  const runtimeSnapshot = input.runtimeSnapshot;

  return {
    meta: {
      ...input.meta,
      ...(runtimeSnapshot
        ? overlayConversationMetaWithRuntimeSnapshot(input.meta, runtimeSnapshot)
        : {
            summary:
              input.meta.summary ||
              sanitizeTranscriptInline(liveSummary || "") ||
              undefined,
          }),
    },
    transcript: input.transcript,
    mentions: input.mentions,
    artifacts: runtimeSnapshot
      ? collectArtifactsFromAssistantParts(runtimeSnapshot.assistant.parts)
      : input.artifacts,
    thread,
  };
}
