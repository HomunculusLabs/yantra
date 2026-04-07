import { NextRequest, NextResponse } from "next/server";
import {
  getIntegrationConfigReadResponse,
  saveIntegrationConfig,
} from "@/lib/agents/integrations-manager";

export async function GET() {
  return NextResponse.json(await getIntegrationConfigReadResponse());
}

export async function PUT(req: NextRequest) {
  try {
    await saveIntegrationConfig(await req.json());
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
