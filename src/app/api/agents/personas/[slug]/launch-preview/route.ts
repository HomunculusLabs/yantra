import { NextResponse } from "next/server";
import { resolveLaunchPreview } from "@/lib/agents/launcher-manager";
import { readPersona } from "@/lib/agents/persona-manager";

type RouteParams = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, { params }: RouteParams) {
  try {
    const { slug } = await params;
    const persona = await readPersona(slug);

    if (!persona) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const preview = await resolveLaunchPreview({ persona });
    return NextResponse.json(preview);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve launch preview";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
