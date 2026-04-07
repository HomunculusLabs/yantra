import fs from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { autoCommit } from "@/lib/git/git-service";
import { fileExists } from "@/lib/storage/fs-operations";
import { resolveVirtualContentPath } from "@/lib/storage/virtual-content-paths";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".css": "text/css",
  ".js": "application/javascript",
  ".html": "text/html",
  ".csv": "text/csv",
};

type RouteParams = { params: Promise<{ path: string[] }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    const resolved = await resolveVirtualContentPath({
      virtualPath,
      access: "read",
    });
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.message }, { status: resolved.status });
    }

    if (!(await fileExists(resolved.absolutePath))) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const buffer = await fs.readFile(resolved.absolutePath);
    const ext = path.extname(resolved.absolutePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");
    const resolved = await resolveVirtualContentPath({
      virtualPath,
      access: "write",
    });
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.message }, { status: resolved.status });
    }

    const body = await req.text();
    await fs.writeFile(resolved.absolutePath, body, "utf-8");
    autoCommit(virtualPath, "Update");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
