"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  formatRelative,
  TRIGGER_LABELS,
  TRIGGER_STYLES,
  type StatusFilter,
  type TriggerFilter,
} from "@/components/agents/agents-workspace.helpers";
import type { AgentSummary } from "@/types/agent-api";
import type { ConversationMeta } from "@/types/conversations";

function TriggerChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-[11px] transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

interface AgentsConversationListProps {
  activeAgent: AgentSummary | null;
  agents: AgentSummary[];
  conversations: ConversationMeta[];
  conversationsLoading: boolean;
  hasLoadedConversations: boolean;
  selectedConversationId: string | null;
  triggerFilter: TriggerFilter;
  statusFilter: StatusFilter;
  onTriggerFilterChange: (filter: TriggerFilter) => void;
  onStatusFilterChange: (filter: StatusFilter) => void;
  onRefresh: () => void;
  onSelectConversation: (conversationId: string) => void;
}

export function AgentsConversationList({
  activeAgent,
  agents,
  conversations,
  conversationsLoading,
  hasLoadedConversations,
  selectedConversationId,
  triggerFilter,
  statusFilter,
  onTriggerFilterChange,
  onStatusFilterChange,
  onRefresh,
  onSelectConversation,
}: AgentsConversationListProps) {
  return (
    <div className="w-[340px] min-w-[340px] border-r border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold">
              {activeAgent ? activeAgent.name : "All agents"}
            </h3>
            <p className="text-[11px] text-muted-foreground">
              {activeAgent
                ? `Recent runs for ${activeAgent.name}`
                : "Recent runs across your whole team"}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(["all", "manual", "job", "heartbeat"] as TriggerFilter[]).map(
            (filter) => (
              <TriggerChip
                key={filter}
                active={triggerFilter === filter}
                onClick={() => onTriggerFilterChange(filter)}
              >
                {filter === "all"
                  ? "All"
                  : filter === "job"
                    ? "Jobs"
                    : filter === "heartbeat"
                      ? "Heartbeat"
                      : "Manual"}
              </TriggerChip>
            )
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(["all", "running", "failed"] as StatusFilter[]).map((filter) => (
            <TriggerChip
              key={filter}
              active={statusFilter === filter}
              onClick={() => onStatusFilterChange(filter)}
            >
              {filter === "all"
                ? "Any status"
                : filter[0].toUpperCase() + filter.slice(1)}
            </TriggerChip>
          ))}
        </div>
      </div>
      <ScrollArea className="h-[calc(100vh-115px)]">
        <div className="space-y-1 p-2">
          {conversationsLoading && conversations.length > 0 ? (
            <div className="flex items-center gap-2 px-3 py-6 text-[12px] text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading conversations...
            </div>
          ) : !hasLoadedConversations && conversations.length === 0 ? (
            <div className="px-3 py-8" />
          ) : conversations.length === 0 ? (
            <div className="animate-in fade-in duration-300 px-3 py-8 text-[12px] text-muted-foreground">
              No conversations yet.
            </div>
          ) : (
            conversations.map((conversation) => {
              const agent = agents.find((entry) => entry.slug === conversation.agentSlug);
              return (
                <button
                  key={conversation.id}
                  onClick={() => onSelectConversation(conversation.id)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-3 text-left transition-colors",
                    selectedConversationId === conversation.id
                      ? "border-primary/30 bg-primary/5"
                      : "border-border hover:bg-accent/40"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 shrink-0">
                      {conversation.status === "running" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : conversation.status === "failed" ? (
                        <XCircle className="h-4 w-4 text-destructive" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-[12px] font-medium text-foreground">
                          {conversation.title}
                        </p>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px]",
                            TRIGGER_STYLES[conversation.trigger]
                          )}
                        >
                          {TRIGGER_LABELS[conversation.trigger]}
                        </span>
                        <Link
                          href={`/agents/conversations/${conversation.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          title="Open transcript page"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {agent?.name || conversation.agentSlug} ·{" "}
                        {formatRelative(conversation.startedAt)}
                      </p>
                      {conversation.summary ? (
                        <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground/80">
                          {conversation.summary}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
