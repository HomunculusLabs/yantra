import { NextRequest, NextResponse } from "next/server";
import { readPage, writePage, createPage } from "@/lib/storage/page-io";
import { deleteNode, moveNode, renameNode } from "@/lib/storage/node-io";
import { autoCommit } from "@/lib/git/git-service";

type RouteParams = { params: Promise<{ path: string[] }> };

function mutationStatusFromMessage(message: string) {
  if (message.includes("not found")) return 404;
  if (message.includes("already exists")) return 409;
  if (
    message.includes("Cannot modify") ||
    message.includes("Cannot move") ||
    message.includes("Target is not a directory")
  ) {
    return 400;
  }
  return 500;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    const page = await readPage(virtualPath);
    return NextResponse.json(page);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    const body = await req.json();
    await writePage(virtualPath, body.content, body.frontmatter);
    const page = await readPage(virtualPath);
    autoCommit(page.path, "Update");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    const body = await req.json();
    const newPath = await createPage(virtualPath, body.title);
    autoCommit(newPath, "Add");
    return NextResponse.json({ ok: true, newPath }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.includes("already exists") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    const body = await req.json();
    if (body.rename) {
      const newPath = await renameNode(virtualPath, body.rename);
      autoCommit(newPath, "Update");
      return NextResponse.json({ ok: true, newPath });
    }
    const newPath = await moveNode(virtualPath, body.toParent || "");
    autoCommit(newPath, "Update");
    return NextResponse.json({ ok: true, newPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: mutationStatusFromMessage(message) });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    await deleteNode(virtualPath);
    autoCommit(virtualPath, "Delete");
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: mutationStatusFromMessage(message) });
  }
}
