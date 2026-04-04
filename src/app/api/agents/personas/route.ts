import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getYantraRoots } from "@/lib/config/yantra-roots";
import { ensureDirectory } from "@/lib/storage/fs-operations";
import {
  listPersonas,
  writePersona,
} from "@/lib/agents/persona-manager";
import { reloadDaemonSchedules } from "@/lib/agents/daemon-client";
import { getRunningConversationCounts } from "@/lib/agents/conversation-store";

// Initialize heartbeats on first request without blocking the UI on daemon health.
let initialized = false;

function kickDaemonScheduleReload(): void {
  void reloadDaemonSchedules({ timeoutMs: 1500 }).catch(() => {});
}

export async function GET() {
  if (!initialized) {
    initialized = true;
    kickDaemonScheduleReload();
  }

  const personas = await listPersonas();
  const activeHeartbeats = personas
    .filter((persona) => persona.active && !!persona.heartbeat)
    .map((persona) => persona.slug);
  const runningCounts = await getRunningConversationCounts();

  return NextResponse.json({
    personas: personas.map((persona) => ({
      ...persona,
      runningCount: runningCounts[persona.slug] || 0,
    })),
    activeHeartbeats,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { slug, ...personaData } = body;

  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  await writePersona(slug, personaData);

  // Create workspace directory for the agent
  const wsDir = path.join(getYantraRoots().runtimeAgentsRoot, slug, "workspace");
  await ensureDirectory(wsDir);

  kickDaemonScheduleReload();

  return NextResponse.json({ ok: true }, { status: 201 });
}
