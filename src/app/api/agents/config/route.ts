import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { getYantraRoots } from "@/lib/config/yantra-roots";

const CONFIG_DIR = getYantraRoots().runtimeConfigRoot;
const COMPANY_FILE = path.join(CONFIG_DIR, "company.json");

export async function GET() {
  try {
    const raw = await fs.readFile(COMPANY_FILE, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch {
    return NextResponse.json({ exists: false });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(COMPANY_FILE, JSON.stringify(body, null, 2), "utf-8");

  return NextResponse.json({ ok: true }, { status: 201 });
}
