import { NextRequest, NextResponse } from "next/server";
import {
  loadIntegrationConfig,
  saveIntegrationConfig,
} from "@/lib/agents/integrations-manager";

export async function GET() {
  return NextResponse.json(await loadIntegrationConfig());
}

export async function PUT(req: NextRequest) {
  try {
    await saveIntegrationConfig(await req.json());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
