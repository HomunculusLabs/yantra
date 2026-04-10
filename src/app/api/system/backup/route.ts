import { NextResponse } from "next/server";
import { createDataBackup } from "@/lib/system/backup";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const backupPath = await createDataBackup("manual-data-backup");
    return NextResponse.json({ ok: true, scope: "data", backupPath });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Backup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
