import { NextRequest, NextResponse } from "next/server";
import {
  listAgentStackCatalog,
  readAgentStack,
  writeAgentStack,
} from "@/lib/agents/stack-manager";

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const [stackData, catalog] = await Promise.all([
      readAgentStack(slug),
      listAgentStackCatalog(),
    ]);

    return NextResponse.json({
      stackPath: stackData.stackPath,
      stack: stackData.stack,
      catalog,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load agent stack";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const body = (await req.json()) as {
      stack?: {
        paths?: {
          primary?: string;
          secondary?: string;
          tertiary?: string;
        };
        contextFiles?: string[];
        skills?: string[];
        skillsets?: string[];
        extraExtensions?: string[];
      };
    };

    const updated = await writeAgentStack(slug, body.stack || {});
    return NextResponse.json(updated);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to save agent stack";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
