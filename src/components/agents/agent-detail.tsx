"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  Clock,
  FileText,
  Pause,
  Play,
  RefreshCw,
  Zap,
} from "lucide-react";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { DefinitionTab } from "@/components/agents/agent-detail/definition-tab";
import { JobsTab } from "@/components/agents/agent-detail/jobs-tab";
import { SessionsTab } from "@/components/agents/agent-detail/sessions-tab";
import { useAgentDetail } from "@/components/agents/agent-detail/use-agent-detail";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

type TabId = "definition" | "jobs" | "sessions";

const TABS: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: "definition", label: "Definition", icon: FileText },
  { id: "jobs", label: "Jobs", icon: Briefcase },
  { id: "sessions", label: "Sessions", icon: Clock },
];

export function AgentDetail({ slug }: { slug: string }) {
  const [activeTab, setActiveTab] = useState<TabId>("definition");
  const setSection = useAppStore((state) => state.setSection);
  const {
    persona,
    history,
    loading,
    running,
    toggling,
    refresh,
    updatePersona,
    runAgent,
    toggleAgent,
  } = useAgentDetail(slug);

  if (loading || !persona) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setSection({ type: "agents" })}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <AgentAvatar name={persona.name} slug={persona.slug} size="md" />
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.02em]">
              {persona.name}
            </h2>
            <p className="text-[11px] text-muted-foreground">{persona.role}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => void runAgent()}
            disabled={running}
          >
            <Zap className="h-3 w-3" />
            {running ? "Running..." : "Run"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => void toggleAgent()}
            disabled={toggling}
          >
            {persona.active ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {persona.active ? "Pause" : "Activate"}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={() => void refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex min-w-[160px] w-[160px] flex-col border-r border-border bg-muted/5 py-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "mx-2 flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] font-medium transition-colors",
                  activeTab === tab.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === "sessions" ? (
          <SessionsTab persona={persona} history={history} onRefresh={refresh} />
        ) : (
          <ScrollArea className="flex-1">
            <div className="p-4">
              {activeTab === "definition" ? (
                <DefinitionTab
                  slug={slug}
                  persona={persona}
                  onSavePersona={updatePersona}
                  onRefresh={refresh}
                />
              ) : null}
              {activeTab === "jobs" ? <JobsTab slug={slug} /> : null}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
