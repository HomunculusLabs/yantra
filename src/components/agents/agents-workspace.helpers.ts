import type { AgentSummary } from "@/types/agent-api";
import type {
  ConversationStatus,
  ConversationTrigger,
} from "@/types/conversations";
import type { TreeNode } from "@/types";

export type TriggerFilter = "all" | "manual" | "job" | "heartbeat";
export type StatusFilter = "all" | "running" | "failed";

export interface WorkspacePageOption {
  path: string;
  title: string;
}

export const GENERAL_AGENT: AgentSummary = {
  name: "General",
  slug: "general",
  emoji: "",
  role: "Manual Yantra assistant",
  active: true,
  runningCount: 0,
  department: "general",
  type: "specialist",
  workspace: "/",
  body: "",
};

export const TRIGGER_LABELS: Record<ConversationTrigger, string> = {
  manual: "Manual",
  job: "Job",
  heartbeat: "Heartbeat",
};

export const TRIGGER_STYLES: Record<ConversationTrigger, string> = {
  manual: "bg-blue-500/10 text-blue-500",
  job: "bg-amber-500/10 text-amber-500",
  heartbeat: "bg-emerald-500/10 text-emerald-500",
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function flattenTree(nodes: TreeNode[]): WorkspacePageOption[] {
  const pages: WorkspacePageOption[] = [];

  for (const node of nodes) {
    if (node.type !== "website") {
      pages.push({
        path: node.path,
        title: node.frontmatter?.title || node.name,
      });
    }
    if (node.children) {
      pages.push(...flattenTree(node.children));
    }
  }

  return pages;
}

export function collectContextOptions(nodes: TreeNode[]): WorkspacePageOption[] {
  const pages: WorkspacePageOption[] = [];

  function walk(list: TreeNode[]) {
    for (const node of list) {
      if (
        (node.type === "file" || node.type === "text") &&
        !node.path.startsWith("@runtime")
      ) {
        pages.push({
          path: node.path,
          title: node.frontmatter?.title || node.name,
        });
      }
      if (node.children) {
        walk(node.children);
      }
    }
  }

  walk(nodes);
  return pages;
}

export function formatRelative(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function triggerFromFilter(
  filter: TriggerFilter
): ConversationTrigger | undefined {
  if (filter === "all") return undefined;
  return filter;
}

export function statusFromFilter(
  filter: StatusFilter
): ConversationStatus | undefined {
  if (filter === "all") return undefined;
  return filter;
}

export function makePageContextLabel(
  path: string,
  pages: WorkspacePageOption[]
): string {
  return pages.find((page) => page.path === path)?.title || path;
}

export function togglePath(paths: string[], path: string): string[] {
  return paths.includes(path)
    ? paths.filter((entry) => entry !== path)
    : [...paths, path];
}
