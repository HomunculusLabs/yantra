import type { ConversationAssistantPart } from "@/types/conversations";
import { sanitizeTranscriptInline } from "./transcript-format";

interface AdvanceRuntimeSummaryHistoryInput {
  previousSummaries: string[];
  latestSummary?: string;
  nextSummary?: string;
  limit?: number;
}

export function advanceRuntimeSummaryHistory(
  input: AdvanceRuntimeSummaryHistoryInput
): { summaryHistory: string[]; latestSummary?: string } {
  const limit = input.limit ?? 3;
  const previousSummaries = input.previousSummaries
    .map((summary) => sanitizeTranscriptInline(summary || ""))
    .filter(Boolean);
  const latestSummary = sanitizeTranscriptInline(input.latestSummary || "") || undefined;
  const nextSummary = sanitizeTranscriptInline(input.nextSummary || "") || undefined;
  const summaryHistory = [...previousSummaries];

  if (
    latestSummary &&
    nextSummary &&
    latestSummary !== nextSummary &&
    summaryHistory[summaryHistory.length - 1] !== latestSummary
  ) {
    summaryHistory.push(latestSummary);
  }

  return {
    summaryHistory: summaryHistory.slice(-limit),
    latestSummary: nextSummary || latestSummary,
  };
}

export function buildRuntimeMilestoneParts(
  sessionId: string,
  summaries: string[]
): ConversationAssistantPart[] {
  return summaries.map((summary, index) => ({
    kind: "status",
    id: `runtime:${sessionId}:milestone:${index}`,
    label: "Milestone",
    tone: "neutral",
    detail: summary,
  }));
}
