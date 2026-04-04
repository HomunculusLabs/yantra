import { NextResponse } from "next/server";
import { buildTree } from "@/lib/storage/tree-builder";
import { ensureVaultRootExists } from "@/lib/config/yantra-roots";

export async function GET() {
  try {
    ensureVaultRootExists();
    const tree = await buildTree();
    return NextResponse.json(tree);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
