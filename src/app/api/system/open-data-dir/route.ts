import { spawn } from "child_process";
import { NextResponse } from "next/server";
import { getYantraRoots } from "@/lib/config/yantra-roots";

export const dynamic = "force-dynamic";

function getOpenCommand(targetPath: string): { command: string; args: string[] } {
  switch (process.platform) {
    case "darwin":
      return { command: "open", args: [targetPath] };
    case "win32":
      return { command: "explorer.exe", args: [targetPath] };
    default:
      return { command: "xdg-open", args: [targetPath] };
  }
}

export async function POST() {
  try {
    const targetPath = getYantraRoots().vaultRoot;
    const { command, args } = getOpenCommand(targetPath);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(command, args, {
        stdio: "ignore",
      });

      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Command exited with code ${code}`));
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
