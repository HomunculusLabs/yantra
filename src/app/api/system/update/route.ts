import { NextResponse } from "next/server";
import { getUpdateCheckResult } from "@/lib/system/update-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await getUpdateCheckResult();
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load update status",
      },
      { status: 500 }
    );
  }
}
