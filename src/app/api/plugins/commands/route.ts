import { NextResponse } from "next/server";
import { listEnabledOpenViewCommands } from "@/lib/plugins/plugin-manager";

export async function GET() {
  try {
    const commands = await listEnabledOpenViewCommands();
    return NextResponse.json({ commands });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
