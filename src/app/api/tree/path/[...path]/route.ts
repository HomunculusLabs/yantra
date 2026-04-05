import { NextRequest, NextResponse } from "next/server";
import { resolveContentPath } from "@/lib/storage/path-utils";
import { fileExists } from "@/lib/storage/fs-operations";

type RouteParams = { params: Promise<{ path: string[] }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    const { path: segments } = await params;
    const virtualPath = segments.join("/");

    if (!virtualPath) {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const absolutePath = resolveContentPath(virtualPath);
    if (!(await fileExists(absolutePath))) {
      return NextResponse.json({ error: `Path not found: ${virtualPath}` }, { status: 404 });
    }

    return NextResponse.json({ virtualPath, absolutePath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
