"use client";

import { cn } from "@/lib/utils";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { AgentChatsPanel } from "./agent-chats-panel";
import { EditorAIPanel } from "./editor-ai-panel";
import { TasksPanel } from "./tasks-panel";

export function AIPanel() {
  const isOpen = useAIPanelStore((state) => state.isOpen);
  const mode = useAIPanelStore((state) => state.mode);

  if (!isOpen) return null;

  return (
    <div
      className={cn(
        "flex flex-col border-l border-border bg-background",
        mode === "agents"
          ? "w-[460px] min-w-[380px]"
          : "w-[480px] min-w-[420px]"
      )}
    >
      {mode === "agents" ? (
        <AgentChatsPanel />
      ) : mode === "tasks" ? (
        <TasksPanel />
      ) : (
        <EditorAIPanel />
      )}
    </div>
  );
}
