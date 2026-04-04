import { NextRequest, NextResponse } from "next/server";
import { readPersona } from "@/lib/agents/persona-manager";
import { listPersonaWorkspaceFiles } from "@/lib/agents/workspace-manager";

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { slug } = await params;
  const persona = await readPersona(slug);
  if (!persona) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(await listPersonaWorkspaceFiles(persona));
}
