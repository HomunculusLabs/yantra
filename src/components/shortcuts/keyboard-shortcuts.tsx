"use client";

import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";
import { useEditorStore } from "@/stores/editor-store";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { KB_TREE_ROOT_ID } from "@/components/sidebar/tree-view";

export function KeyboardShortcuts() {
  const { toggleTerminal, sidebarCollapsed, setSidebarCollapsed } = useAppStore();
  const { save } = useEditorStore();
  const panelOpen = useAIPanelStore((state) => state.isOpen);
  const panelMode = useAIPanelStore((state) => state.mode);
  const closeAI = useAIPanelStore((state) => state.close);
  const openEditorPanel = useAIPanelStore((state) => state.openEditorPanel);
  const openAgentPanel = useAIPanelStore((state) => state.openAgentPanel);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;

      if (isMod && event.key === "s") {
        event.preventDefault();
        void save();
      }

      if (isMod && event.key === "`") {
        event.preventDefault();
        toggleTerminal();
      }

      if (isMod && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        if (panelOpen && panelMode === "editor") {
          closeAI();
        } else {
          openEditorPanel();
        }
      }

      if (isMod && event.key.toLowerCase() === "m" && !event.shiftKey) {
        event.preventDefault();
        if (panelOpen && panelMode === "agents") {
          closeAI();
        } else {
          openAgentPanel(null);
        }
      }

      if (isMod && event.shiftKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        if (sidebarCollapsed) {
          setSidebarCollapsed(false);
        }
        requestAnimationFrame(() => {
          document.getElementById(KB_TREE_ROOT_ID)?.focus();
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    closeAI,
    openAgentPanel,
    openEditorPanel,
    panelMode,
    panelOpen,
    save,
    sidebarCollapsed,
    setSidebarCollapsed,
    toggleTerminal,
  ]);

  return null;
}
