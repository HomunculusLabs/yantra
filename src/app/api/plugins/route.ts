import { NextResponse } from "next/server";
import { listInstalledPlugins } from "@/lib/plugins/plugin-manager";

export async function GET() {
  try {
    return NextResponse.json(await listInstalledPlugins());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list installed plugins";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
