import { NextResponse } from "next/server";
import { listPersonas } from "@/lib/agents/persona-manager";
import { listGalleryItemsForPersonas } from "@/lib/agents/workspace-manager";

export async function GET() {
  try {
    const personas = await listPersonas();
    const items = await listGalleryItemsForPersonas(personas);
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
