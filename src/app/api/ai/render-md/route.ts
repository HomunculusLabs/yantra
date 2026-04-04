import { NextRequest, NextResponse } from "next/server";
import { renderMarkdownToHtml } from "@/lib/markdown/render";

export async function POST(req: NextRequest) {
  try {
    const { markdown, pagePath } = await req.json();
    if (!markdown) return NextResponse.json({ html: "" });
    const html = await renderMarkdownToHtml(markdown, pagePath);
    return NextResponse.json({ html });
  } catch {
    return NextResponse.json({ html: "" }, { status: 500 });
  }
}
