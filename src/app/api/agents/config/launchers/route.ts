import { NextRequest, NextResponse } from "next/server";
import {
  getLauncherRegistryReadResponse,
  saveLauncherRegistry,
  validateLauncherRegistryConfig,
} from "@/lib/agents/launcher-manager";

export async function GET() {
  try {
    const response = await getLauncherRegistryReadResponse();
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const payload =
      body && typeof body === "object" && "registry" in body ? body.registry : body;
    const { config, issues } = validateLauncherRegistryConfig(payload);
    if (issues.length > 0) {
      return NextResponse.json(
        {
          error: "Launcher registry validation failed.",
          details: issues,
        },
        { status: 400 }
      );
    }

    await saveLauncherRegistry(config);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
