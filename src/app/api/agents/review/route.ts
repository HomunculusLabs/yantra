import { NextRequest, NextResponse } from "next/server";
import {
  startConversationRun,
  waitForConversationCompletion,
} from "@/lib/agents/conversation-runner";

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
}

export async function POST(req: NextRequest) {
  try {
    const { taskId, title, description, tags, linkedPages } = await req.json();

    if (!title) {
      return NextResponse.json(
        { error: "title is required" },
        { status: 400 }
      );
    }

    const prompt = `You are an AI task reviewer for an Obsidian-based operations workspace. Review this task and suggest improvements.

TASK:
- Title: ${title}
- Description: ${description || "(none)"}
- Tags: ${tags?.length ? tags.join(", ") : "(none)"}
- Linked pages: ${linkedPages?.length ? linkedPages.join(", ") : "(none)"}

Respond with ONLY a JSON object (no markdown, no code fences, no explanation) with these fields:
{
  "description": "improved description with clear scope and acceptance criteria (2-4 sentences)",
  "tags": ["suggested", "tags", "max-4"],
  "priority": "P0|P1|P2",
  "estimatedEffort": "small|medium|large",
  "acceptanceCriteria": ["criterion 1", "criterion 2", "criterion 3"],
  "suggestions": "one sentence of strategic advice about this task"
}

Rules:
- Keep the original intent
- Description should be actionable and specific
- Tags should categorize the work area
- Priority: P0 = do now, P1 = do this week, P2 = backlog
- Acceptance criteria should be concrete and verifiable
- Output ONLY valid JSON, nothing else`;

    const conversation = await startConversationRun({
      agentSlug: "general",
      title: `Task review: ${title}`.slice(0, 80),
      trigger: "manual",
      prompt,
      timeoutSeconds: 120,
    });

    const completion = await waitForConversationCompletion(conversation.id);
    if (completion.status !== "completed") {
      return NextResponse.json(
        { error: completion.output || "Review failed" },
        { status: 500 }
      );
    }

    const cleaned = stripCodeFences(completion.output);
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Review response did not contain JSON", output: completion.output },
        { status: 500 }
      );
    }

    const review = JSON.parse(jsonMatch[0]);

    return NextResponse.json({
      ok: true,
      taskId,
      conversationId: conversation.id,
      review,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
