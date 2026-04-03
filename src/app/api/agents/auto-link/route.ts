import { NextRequest, NextResponse } from "next/server";
import { buildTree } from "@/lib/storage/tree-builder";
import type { TreeNode } from "@/types";
import {
  startConversationRun,
  waitForConversationCompletion,
} from "@/lib/agents/conversation-runner";

function flattenPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    paths.push(`${node.path} (${node.frontmatter?.title || node.name})`);
    if (node.children) paths.push(...flattenPaths(node.children));
  }
  return paths;
}

export async function POST(req: NextRequest) {
  try {
    const { title, description } = await req.json();
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const tree = await buildTree();
    const pageList = flattenPaths(tree).join("\n");

    const prompt = `Given this task:
Title: ${title}
Description: ${description || "None"}

And these knowledge base pages:
${pageList}

Return ONLY a JSON array of page paths that are relevant to this task. Example: ["companies/competitors", "engineering/api-docs"]
If no pages are relevant, return []. Return ONLY the JSON array, nothing else.`;

    const conversation = await startConversationRun({
      agentSlug: "general",
      title: `Auto-link: ${title}`.slice(0, 80),
      trigger: "manual",
      prompt,
      timeoutSeconds: 30,
    });

    const completion = await waitForConversationCompletion(conversation.id);
    if (completion.status !== "completed") {
      return NextResponse.json(
        { error: completion.output || "Auto-link failed" },
        { status: 500 }
      );
    }

    let linkedPages: string[] = [];
    try {
      const match = completion.output.match(/\[[\s\S]*\]/);
      if (match) {
        linkedPages = JSON.parse(match[0]);
      }
    } catch {
      linkedPages = [];
    }

    return NextResponse.json({ linkedPages, conversationId: conversation.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
