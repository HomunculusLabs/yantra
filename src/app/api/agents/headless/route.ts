import { NextRequest, NextResponse } from "next/server";
import {
  startConversationRun,
  waitForConversationCompletion,
} from "@/lib/agents/conversation-runner";

function makeTitle(text: string): string {
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) || "Headless run";
  return firstLine.slice(0, 80);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt =
      typeof body.prompt === "string" && body.prompt.trim()
        ? body.prompt.trim()
        : typeof body.instruction === "string" && body.instruction.trim()
          ? body.instruction.trim()
          : typeof body.userMessage === "string" && body.userMessage.trim()
            ? body.userMessage.trim()
            : "";
    const captureOutput = body.captureOutput !== false;
    const workdir =
      typeof body.workdir === "string" && body.workdir.trim()
        ? body.workdir.trim()
        : undefined;
    const timeoutSeconds =
      typeof body.timeoutSeconds === "number" ? body.timeoutSeconds : 120;
    const agentSlug =
      typeof body.agentSlug === "string" && body.agentSlug.trim()
        ? body.agentSlug.trim()
        : "general";

    if (!prompt) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 }
      );
    }

    const conversation = await startConversationRun({
      agentSlug,
      title: makeTitle(prompt),
      trigger: "manual",
      prompt,
      cwd: workdir,
      timeoutSeconds,
    });

    const completion = await waitForConversationCompletion(conversation.id);

    return NextResponse.json({
      ok: completion.status === "completed",
      status: completion.status,
      conversationId: conversation.id,
      output: captureOutput ? completion.output : undefined,
      message:
        completion.status === "completed"
          ? "Completed successfully"
          : "Run failed",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
