import { NextRequest, NextResponse } from "next/server";
import { createPage } from "@/lib/storage/page-io";
import { autoCommit } from "@/lib/git/git-service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const newPath = await createPage("", body.title || "Untitled");
    autoCommit(newPath, "Add");
    return NextResponse.json({ ok: true, newPath }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("already exists") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
