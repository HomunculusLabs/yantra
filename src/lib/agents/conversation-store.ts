import fs from "fs/promises";
import path from "path";
import type {
  ConversationAgentProposal,
  ConversationArtifact,
  ConversationDetail,
  ConversationMeta,
  ConversationStatus,
  ConversationTrigger,
} from "@/types/conversations";
import { getYantraRoots } from "@/lib/config/yantra-roots";
import { sanitizeFilename, virtualPathFromFs } from "../storage/path-utils";
import {
  ensureDirectory,
  fileExists,
  listDirectory,
  readFileContent,
  writeFileContent,
} from "../storage/fs-operations";
import {
  makeSummaryFromOutput,
  normalizeAgentProposal,
  parseAgentProposalBlock,
  parseYantraBlock,
} from "./conversation-output-parser";
import { buildConversationPresentation } from "./conversation-thread";
import {
  sanitizeTranscriptForDisplay,
  sanitizeTranscriptInline,
} from "./transcript-format";

export const CONVERSATIONS_DIR = path.join(
  getYantraRoots().runtimeAgentsRoot,
  ".conversations"
);

interface CreateConversationInput {
  agentSlug: string;
  title: string;
  trigger: ConversationTrigger;
  prompt: string;
  mentionedPaths?: string[];
  jobId?: string;
  jobName?: string;
  startedAt?: string;
  userMessage?: string;
  pagePath?: string;
}

interface ListConversationFilters {
  agentSlug?: string;
  trigger?: ConversationTrigger;
  status?: ConversationStatus;
  limit?: number;
}

export interface ConversationReadRecord {
  meta: ConversationMeta;
  prompt: string;
  transcript: string;
  mentions: string[];
  artifacts: ConversationArtifact[];
}

function formatTimestampSegment(date: Date): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sanitizeSegment(value: string, fallback: string): string {
  return sanitizeFilename(value) || fallback;
}

function conversationDir(id: string): string {
  return path.join(CONVERSATIONS_DIR, id);
}

function metaPath(id: string): string {
  return path.join(conversationDir(id), "meta.json");
}

function transcriptPathFs(id: string): string {
  return path.join(conversationDir(id), "transcript.txt");
}

function promptPathFs(id: string): string {
  return path.join(conversationDir(id), "prompt.md");
}

function mentionsPathFs(id: string): string {
  return path.join(conversationDir(id), "mentions.json");
}

function artifactsPathFs(id: string): string {
  return path.join(conversationDir(id), "artifacts.json");
}

function normalizeConversationMeta(meta: ConversationMeta): ConversationMeta {
  return {
    ...meta,
    title: sanitizeTranscriptInline(meta.title || "") || meta.title,
    summary: meta.summary ? sanitizeTranscriptInline(meta.summary) : undefined,
    contextSummary: meta.contextSummary
      ? sanitizeTranscriptInline(meta.contextSummary)
      : undefined,
    userMessage: meta.userMessage
      ? sanitizeTranscriptInline(meta.userMessage)
      : undefined,
    pagePath: meta.pagePath ? sanitizeTranscriptInline(meta.pagePath) : undefined,
    runtimeSession: meta.runtimeSession
      ? {
          launchTransport: meta.runtimeSession.launchTransport,
          startedAt:
            sanitizeTranscriptInline(meta.runtimeSession.startedAt) ||
            meta.runtimeSession.startedAt,
          tmuxSessionName: meta.runtimeSession.tmuxSessionName
            ? sanitizeTranscriptInline(meta.runtimeSession.tmuxSessionName)
            : undefined,
          tmuxAttachCommand: meta.runtimeSession.tmuxAttachCommand
            ? sanitizeTranscriptInline(meta.runtimeSession.tmuxAttachCommand)
            : undefined,
          exitedAt: meta.runtimeSession.exitedAt
            ? sanitizeTranscriptInline(meta.runtimeSession.exitedAt)
            : undefined,
          exitCode: meta.runtimeSession.exitCode ?? undefined,
          eventStreamFormat:
            meta.runtimeSession.eventStreamFormat === "structured_v1"
              ? "structured_v1"
              : undefined,
        }
      : undefined,
    artifactPaths: (meta.artifactPaths || [])
      .map((artifactPath) => sanitizeTranscriptInline(artifactPath))
      .filter(Boolean),
    mentionedPaths: (meta.mentionedPaths || [])
      .map((mentionedPath) => sanitizeTranscriptInline(mentionedPath))
      .filter(Boolean),
    agentProposal: normalizeAgentProposal(meta.agentProposal),
  };
}

function mergeConversationProposal(
  existing: ConversationAgentProposal | undefined,
  parsed: ConversationAgentProposal | undefined
): ConversationAgentProposal | undefined {
  if (!existing) {
    return parsed;
  }

  if (existing.status === "applied") {
    return normalizeAgentProposal({
      ...(parsed || existing),
      ...existing,
      status: "applied",
    });
  }

  if (existing.status === "declined") {
    return normalizeAgentProposal({
      ...(parsed || existing),
      ...existing,
      status: "declined",
    });
  }

  return parsed;
}

export function buildConversationId(input: {
  agentSlug: string;
  trigger: ConversationTrigger;
  jobName?: string;
  now?: Date;
}): string {
  const now = input.now || new Date();
  const parts = [
    formatTimestampSegment(now),
    sanitizeSegment(input.agentSlug, "agent"),
    input.trigger,
  ];

  if (input.trigger === "job" && input.jobName) {
    parts.push(sanitizeSegment(input.jobName, "job"));
  }

  return parts.join("-");
}

export async function ensureConversationsDir(): Promise<void> {
  await ensureDirectory(CONVERSATIONS_DIR);
}

export async function createConversation(
  input: CreateConversationInput
): Promise<ConversationMeta> {
  await ensureConversationsDir();

  const startedAt = input.startedAt || new Date().toISOString();
  const id = buildConversationId({
    agentSlug: input.agentSlug,
    trigger: input.trigger,
    jobName: input.jobName || input.jobId,
    now: new Date(startedAt),
  });
  const dir = conversationDir(id);
  await ensureDirectory(dir);

  const meta = normalizeConversationMeta({
    id,
    agentSlug: input.agentSlug,
    title: input.title,
    trigger: input.trigger,
    status: "running",
    startedAt,
    jobId: input.jobId,
    jobName: input.jobName,
    promptPath: virtualPathFromFs(promptPathFs(id)),
    transcriptPath: virtualPathFromFs(transcriptPathFs(id)),
    mentionedPaths: input.mentionedPaths || [],
    artifactPaths: [],
    userMessage: input.userMessage,
    pagePath: input.pagePath,
  });

  await Promise.all([
    writeFileContent(promptPathFs(id), input.prompt),
    writeFileContent(transcriptPathFs(id), ""),
    writeFileContent(
      mentionsPathFs(id),
      JSON.stringify(input.mentionedPaths || [], null, 2)
    ),
    writeFileContent(artifactsPathFs(id), JSON.stringify([], null, 2)),
    writeFileContent(metaPath(id), JSON.stringify(meta, null, 2)),
  ]);

  return meta;
}

export async function readConversationMeta(
  id: string
): Promise<ConversationMeta | null> {
  const filePath = metaPath(id);
  if (!(await fileExists(filePath))) return null;
  try {
    const raw = await readFileContent(filePath);
    return normalizeConversationMeta(JSON.parse(raw) as ConversationMeta);
  } catch {
    return null;
  }
}

export async function writeConversationMeta(meta: ConversationMeta): Promise<void> {
  await ensureDirectory(conversationDir(meta.id));
  await writeFileContent(
    metaPath(meta.id),
    JSON.stringify(normalizeConversationMeta(meta), null, 2)
  );
}

export async function appendConversationTranscript(
  id: string,
  chunk: string
): Promise<void> {
  await ensureDirectory(conversationDir(id));
  await fs.appendFile(transcriptPathFs(id), chunk, "utf-8");
}

export async function replaceConversationArtifacts(
  id: string,
  artifacts: ConversationArtifact[]
): Promise<void> {
  await ensureDirectory(conversationDir(id));
  await writeFileContent(artifactsPathFs(id), JSON.stringify(artifacts, null, 2));
}

export async function finalizeConversation(
  id: string,
  input: {
    status: ConversationStatus;
    exitCode?: number | null;
    output?: string;
  }
): Promise<ConversationMeta | null> {
  const currentMeta = await readConversationMeta(id);
  if (!currentMeta) return null;

  const rawOutput =
    input.output ?? (await readFileContent(transcriptPathFs(id)).catch(() => ""));
  const output = sanitizeTranscriptForDisplay(rawOutput);
  const parsed = parseYantraBlock(output);
  const parsedProposal = parseAgentProposalBlock(rawOutput);
  const artifacts = parsed.artifactPaths.map((artifactPath) => ({
    path: artifactPath,
  }));

  const completedAt = new Date().toISOString();
  const nextMeta = normalizeConversationMeta({
    ...currentMeta,
    status: input.status,
    completedAt,
    exitCode: input.exitCode ?? null,
    summary:
      sanitizeTranscriptInline(
        parsed.summary || makeSummaryFromOutput(output) || ""
      ) || undefined,
    contextSummary: parsed.contextSummary
      ? sanitizeTranscriptInline(parsed.contextSummary)
      : undefined,
    artifactPaths: artifacts.map((artifact) => artifact.path),
    agentProposal: mergeConversationProposal(currentMeta.agentProposal, parsedProposal),
    runtimeSession: currentMeta.runtimeSession
      ? {
          ...currentMeta.runtimeSession,
          exitedAt: completedAt,
          exitCode: input.exitCode ?? null,
        }
      : undefined,
  });

  await Promise.all([
    writeConversationMeta(nextMeta),
    writeFileContent(transcriptPathFs(id), output),
    replaceConversationArtifacts(id, artifacts),
  ]);

  return nextMeta;
}

export async function markConversationAgentProposalCreated(
  id: string,
  input: { createdAgentSlug: string; appliedAt?: string }
): Promise<ConversationMeta | null> {
  const meta = await readConversationMeta(id);
  if (!meta?.agentProposal) return null;

  if (meta.agentProposal.status === "declined") {
    throw new Error("Conversation proposal was declined and must be restored first.");
  }

  if (
    meta.agentProposal.status === "applied" &&
    meta.agentProposal.createdAgentSlug &&
    meta.agentProposal.createdAgentSlug !== input.createdAgentSlug
  ) {
    throw new Error("Conversation proposal is already linked to a different agent.");
  }

  meta.agentProposal = {
    ...meta.agentProposal,
    status: "applied",
    createdAgentSlug: input.createdAgentSlug,
    appliedAt: input.appliedAt || new Date().toISOString(),
    declinedAt: undefined,
  };

  await writeConversationMeta(meta);
  return meta;
}

export async function declineConversationAgentProposal(
  id: string,
  input?: { declinedAt?: string }
): Promise<ConversationMeta | null> {
  const meta = await readConversationMeta(id);
  if (!meta?.agentProposal || meta.agentProposal.status !== "pending") {
    return null;
  }

  meta.agentProposal = {
    ...meta.agentProposal,
    status: "declined",
    declinedAt: input?.declinedAt || new Date().toISOString(),
  };

  await writeConversationMeta(meta);
  return meta;
}

export async function restoreConversationAgentProposal(
  id: string
): Promise<ConversationMeta | null> {
  const meta = await readConversationMeta(id);
  if (!meta?.agentProposal || meta.agentProposal.status !== "declined") {
    return null;
  }

  meta.agentProposal = {
    ...meta.agentProposal,
    status: "pending",
    declinedAt: undefined,
  };

  await writeConversationMeta(meta);
  return meta;
}

export async function readConversationTranscript(id: string): Promise<string> {
  const filePath = transcriptPathFs(id);
  if (!(await fileExists(filePath))) return "";
  return sanitizeTranscriptForDisplay(await readFileContent(filePath));
}

export async function readConversationRecord(
  id: string
): Promise<ConversationReadRecord | null> {
  const meta = await readConversationMeta(id);
  if (!meta) return null;

  const [hasPrompt, hasMentions, hasArtifacts] = await Promise.all([
    fileExists(promptPathFs(id)),
    fileExists(mentionsPathFs(id)),
    fileExists(artifactsPathFs(id)),
  ]);

  const [prompt, transcript, mentionsRaw, artifactsRaw] = await Promise.all([
    hasPrompt ? readFileContent(promptPathFs(id)) : Promise.resolve(""),
    readConversationTranscript(id),
    hasMentions ? readFileContent(mentionsPathFs(id)) : Promise.resolve("[]"),
    hasArtifacts ? readFileContent(artifactsPathFs(id)) : Promise.resolve("[]"),
  ]);

  let mentions: string[] = [];
  let artifacts: ConversationArtifact[] = [];

  try {
    mentions = (JSON.parse(mentionsRaw) as string[])
      .map((mentionedPath) => sanitizeTranscriptInline(mentionedPath))
      .filter(Boolean);
  } catch {
    mentions = [];
  }

  try {
    artifacts = (JSON.parse(artifactsRaw) as ConversationArtifact[])
      .map((artifact) => ({
        ...artifact,
        path: sanitizeTranscriptInline(artifact.path),
        label: artifact.label ? sanitizeTranscriptInline(artifact.label) : undefined,
      }))
      .filter((artifact) => Boolean(artifact.path));
  } catch {
    artifacts = [];
  }

  return {
    meta,
    prompt,
    transcript,
    mentions,
    artifacts,
  };
}

export async function readConversationDetail(
  id: string
): Promise<ConversationDetail | null> {
  const record = await readConversationRecord(id);
  if (!record) return null;

  return {
    ...buildConversationPresentation(record),
    prompt: record.prompt,
  };
}

export async function listConversationMetas(
  filters: ListConversationFilters = {}
): Promise<ConversationMeta[]> {
  await ensureConversationsDir();
  const entries = await listDirectory(CONVERSATIONS_DIR);

  const metas = (
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory)
        .map((entry) => readConversationMeta(entry.name))
    )
  ).filter(Boolean) as ConversationMeta[];

  const filtered = metas.filter((meta) => {
    if (filters.agentSlug && meta.agentSlug !== filters.agentSlug) return false;
    if (filters.trigger && meta.trigger !== filters.trigger) return false;
    if (filters.status && meta.status !== filters.status) return false;
    return true;
  });

  filtered.sort(
    (a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  return filtered.slice(0, filters.limit || 200);
}

export async function getRunningConversationCounts(): Promise<Record<string, number>> {
  const running = await listConversationMetas({ status: "running", limit: 1000 });
  return running.reduce<Record<string, number>>((acc, meta) => {
    acc[meta.agentSlug] = (acc[meta.agentSlug] || 0) + 1;
    return acc;
  }, {});
}
