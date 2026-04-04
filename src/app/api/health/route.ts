import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "yantra-web",
    mode: process.env.YANTRA_APP_MODE || "source",
    timestamp: new Date().toISOString(),
  });
}
