import fs from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { resolveHostedPluginAsset } from "@/lib/plugins/plugin-manager";

type RouteParams = {
  params: Promise<{
    entryKey: string;
    assetPath: string[];
  }>;
};

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
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function getContentType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function getPluginHtmlCsp(): string {
  return [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    "connect-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function resolveAccessControlOrigin(request: Request): string | null {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin) {
    return null;
  }

  const appOrigin = new URL(request.url).origin;
  if (requestOrigin === "null" || requestOrigin === appOrigin) {
    return requestOrigin;
  }

  return null;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { entryKey: entryToken, assetPath } = await params;
  const relativePath = assetPath.join("/");

  const resolved = await resolveHostedPluginAsset({ entryToken, relativePath });
  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.message }, { status: resolved.status });
  }

  const buffer = await fs.readFile(resolved.absolutePath);
  const contentType = getContentType(resolved.absolutePath);
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  const accessControlOrigin = resolveAccessControlOrigin(request);
  if (accessControlOrigin) {
    headers.set("Access-Control-Allow-Origin", accessControlOrigin);
    headers.set("Vary", "Origin");
  }

  if (contentType.startsWith("text/html")) {
    headers.set("Content-Security-Policy", getPluginHtmlCsp());
  }

  return new NextResponse(buffer, { headers });
}
