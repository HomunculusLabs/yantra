import { describe, expect, test } from "bun:test";
import {
  advanceRuntimeSummaryHistory,
  buildRuntimeMilestoneParts,
} from "@/lib/agents/conversation-runtime-progress";

describe("conversation-runtime-progress", () => {
  test("tracks prior summaries without duplicating the current summary", () => {
    const first = advanceRuntimeSummaryHistory({
      previousSummaries: [],
      latestSummary: undefined,
      nextSummary: "Indexing the vault",
    });
    expect(first).toEqual({
      summaryHistory: [],
      latestSummary: "Indexing the vault",
    });

    const second = advanceRuntimeSummaryHistory({
      previousSummaries: first.summaryHistory,
      latestSummary: first.latestSummary,
      nextSummary: "Drafting the librarian agent",
    });
    expect(second).toEqual({
      summaryHistory: ["Indexing the vault"],
      latestSummary: "Drafting the librarian agent",
    });
  });

  test("caps summary history to the latest milestones", () => {
    const result = advanceRuntimeSummaryHistory({
      previousSummaries: ["one", "two", "three"],
      latestSummary: "four",
      nextSummary: "five",
      limit: 3,
    });

    expect(result).toEqual({
      summaryHistory: ["two", "three", "four"],
      latestSummary: "five",
    });
  });

  test("builds milestone status parts", () => {
    expect(
      buildRuntimeMilestoneParts("conversation-1", [
        "Indexed the vault",
        "Drafted the librarian agent",
      ])
    ).toEqual([
      {
        kind: "status",
        id: "runtime:conversation-1:milestone:0",
        label: "Milestone",
        tone: "neutral",
        detail: "Indexed the vault",
      },
      {
        kind: "status",
        id: "runtime:conversation-1:milestone:1",
        label: "Milestone",
        tone: "neutral",
        detail: "Drafted the librarian agent",
      },
    ]);
  });
});
