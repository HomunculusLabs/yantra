import { NextRequest, NextResponse } from "next/server";
import {
  createDaemonSession,
  listDaemonSessions,
} from "@/lib/agents/daemon-client";
import { resolveLaunchSpec } from "@/lib/agents/launcher-manager";
import { readPersona } from "@/lib/agents/persona-manager";

export async function GET() {
  try {
    const sessions = await listDaemonSessions();
    return NextResponse.json(sessions);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list daemon sessions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt =
      typeof body.prompt === "string" ? body.prompt.trim() : "";
    const agentSlug =
      typeof body.agentSlug === "string" && body.agentSlug.trim()
        ? body.agentSlug.trim()
        : "general";
    const sessionId =
      typeof body.sessionId === "string" && body.sessionId.trim()
        ? body.sessionId.trim()
        : `session-${Date.now()}`;
    const cwd =
      typeof body.cwd === "string" && body.cwd.trim()
        ? body.cwd.trim()
        : undefined;
    const timeoutSeconds =
      typeof body.timeoutSeconds === "number" ? body.timeoutSeconds : undefined;

    if (!prompt) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 }
      );
    }

    const persona =
      agentSlug === "general" ? null : await readPersona(agentSlug);
    if (agentSlug !== "general" && !persona) {
      return NextResponse.json(
        { error: `Agent not found: ${agentSlug}` },
        { status: 404 }
      );
    }

    const launch = await resolveLaunchSpec({
      prompt,
      persona,
      cwd,
    });

    await createDaemonSession({
      id: sessionId,
      prompt,
      launch,
      timeoutSeconds,
    });

    return NextResponse.json({ ok: true, sessionId }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create daemon session";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
