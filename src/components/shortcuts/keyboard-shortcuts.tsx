"use client";

import { useEffect } from "react";
import { useAppStore } from "@/stores/app-store";
import { useEditorStore } from "@/stores/editor-store";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { KB_TREE_ROOT_ID } from "@/components/sidebar/tree-view";

export function KeyboardShortcuts() {
  const { toggleTerminal, section, setSection, sidebarCollapsed, setSidebarCollapsed } = useAppStore();
  const { save } = useEditorStore();
  const { toggle: toggleAI } = useAIPanelStore();

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
        toggleAI();
      }

      if (isMod && event.key.toLowerCase() === "m" && !event.shiftKey) {
        event.preventDefault();
        if (section.type === "agents") {
          setSection({ type: "page" });
        } else {
          setSection({ type: "agents" });
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
  }, [save, section, setSection, sidebarCollapsed, setSidebarCollapsed, toggleAI, toggleTerminal]);

  return null;
}
