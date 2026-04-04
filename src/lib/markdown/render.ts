import { markdownToHtml } from "@/lib/markdown/to-html";
import { renderDataviewBlocks } from "@/lib/markdown/dataview";

export async function renderMarkdownToHtml(
  markdown: string,
  pagePath?: string
): Promise<string> {
  const withDataview = await renderDataviewBlocks(markdown, pagePath);
  return markdownToHtml(withDataview, pagePath);
}
