import { NextRequest, NextResponse } from "next/server";
import {
  getOrCreateDaemonToken,
  getPublicDaemonEndpoints,
} from "@/lib/agents/daemon-auth";

export async function GET(req: NextRequest) {
  const token = await getOrCreateDaemonToken();
  const requestProtocol = (
    req.headers.get("x-forwarded-proto") ||
    req.nextUrl.protocol.replace(":", "") ||
    "http"
  ) as "http" | "https";
  const requestHost = req.headers.get("host") || req.nextUrl.host;
  const endpoints = getPublicDaemonEndpoints({
    requestOrigin: req.headers.get("origin") || undefined,
    requestHost,
    requestProtocol,
  });

  return NextResponse.json({
    token,
    ...endpoints,
  });
}
