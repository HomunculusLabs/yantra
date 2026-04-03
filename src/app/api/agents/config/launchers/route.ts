import { NextRequest, NextResponse } from "next/server";
import {
  loadLauncherRegistry,
  saveLauncherRegistry,
} from "@/lib/agents/launcher-manager";

export async function GET() {
  try {
    const config = await loadLauncherRegistry();
    return NextResponse.json(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    await saveLauncherRegistry(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
