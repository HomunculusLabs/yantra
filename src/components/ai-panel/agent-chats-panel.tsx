"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  ChevronDown,
  FileText,
  Loader2,
  Plus,
  Settings,
  X,
  XCircle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { WebTerminal } from "@/components/terminal/web-terminal";
import { AgentAvatar } from "@/components/agents/agent-avatar";
import { ConversationComposer, type FlatPage } from "./conversation-composer";
import { ConversationThreadView } from "./conversation-thread-view";
import { useConversationThread } from "./use-conversation-thread";
import { useAIPanelStore } from "@/stores/ai-panel-store";
import { useTreeStore } from "@/stores/tree-store";
import { useAppStore } from "@/stores/app-store";
import { useAgentCreationDraftStore } from "@/stores/agent-creation-draft-store";
import {
  createManualConversation,
  listAgentConversations,
  listAgentPersonas,
  patchConversationProposal,
} from "@/lib/api/agents-client";
import { replacePastedTextNotice } from "@/lib/agents/transcript-format";
import type { TreeNode } from "@/types";
import type { AgentPersonaDraft } from "@/types/agent-api";
import type {
  ConversationDetail,
  ConversationMeta,
} from "@/types/conversations";

interface AgentSummary {
  name: string;
  slug: string;
  emoji: string;
  role: string;
  active: boolean;
  runningCount?: number;
}

type ViewFilter = "all" | "running" | "failed";
type DetailTab = "messages" | "terminal" | "transcript";

const GENERAL_AGENT: AgentSummary = {
  name: "General",
  slug: "general",
  emoji: "",
  role: "Manual Yantra assistant",
  active: true,
  runningCount: 0,
};

const TRIGGER_LABELS: Record<ConversationMeta["trigger"], string> = {
  manual: "Manual",
  job: "Job",
  heartbeat: "Heartbeat",
};

const TRIGGER_STYLES: Record<ConversationMeta["trigger"], string> = {
  manual: "bg-primary/10 text-primary",
  job: "bg-amber-500/10 text-amber-600",
  heartbeat: "bg-emerald-500/10 text-emerald-600",
};

function flattenTree(nodes: TreeNode[]): FlatPage[] {
  const result: FlatPage[] = [];
  for (const node of nodes) {
    if (node.type !== "website") {
      result.push({
        path: node.path,
        title: node.frontmatter?.title || node.name,
      });
    }
    if (node.children?.length) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function filterConversations(
  conversations: ConversationMeta[],
  viewFilter: ViewFilter
) {
  if (viewFilter === "running") {
    return conversations.filter((conversation) => conversation.status === "running");
  }
  if (viewFilter === "failed") {
    return conversations.filter((conversation) => conversation.status === "failed");
  }
  return conversations;
}

function proposalBadge(meta: ConversationMeta): { label: string; className: string } | null {
  if (!meta.agentProposal) return null;
  if (meta.agentProposal.status === "pending") {
    return { label: "Draft", className: "bg-primary/10 text-primary" };
  }
  if (meta.agentProposal.status === "applied") {
    return { label: "Created", className: "bg-emerald-500/10 text-emerald-600" };
  }
  if (meta.agentProposal.status === "declined") {
    return { label: "Declined", className: "bg-muted text-muted-foreground" };
  }
  return null;
}

function structuredFeedBadge(
  meta: ConversationMeta
): { label: string; className: string } | null {
  if (!meta.runtimeSession?.eventStreamFormat) return null;

  if (meta.status === "running") {
    return {
      label: meta.runtimeSession.launchTransport === "tmux" ? "Live · tmux" : "Live",
      className: "bg-sky-500/10 text-sky-600",
    };
  }

  return {
    label: "Structured",
    className: "bg-sky-500/10 text-sky-600",
  };
}

function statusToneClass(tone: "neutral" | "success" | "warning" | "error") {
  if (tone === "success") return "bg-emerald-500/10 text-emerald-600";
  if (tone === "warning") return "bg-amber-500/10 text-amber-600";
  if (tone === "error") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

function detailStatusBadge(
  detail: ConversationDetail | null
): { label: string; detail?: string; className: string } | null {
  if (!detail) return null;

  const assistantItem =
    detail.thread.streamingItem ||
    [...detail.thread.items].reverse().find((item) => item.kind === "assistant");
  const statusPart = assistantItem?.parts.find((part) => part.kind === "status");
  if (!statusPart) return null;

  return {
    label: statusPart.label,
    detail: statusPart.detail,
    className: statusToneClass(statusPart.tone),
  };
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "secondary" : "ghost"}
      size="xs"
      className="h-6 rounded-full px-2"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function AgentChatsPanel() {
  const close = useAIPanelStore((state) => state.close);
  const activeAgentSlug = useAIPanelStore((state) => state.activeAgentSlug);
  const setActiveAgentSlug = useAIPanelStore((state) => state.setActiveAgentSlug);
  const selectedConversationId = useAIPanelStore((state) => state.selectedConversationId);
  const setSelectedConversationId = useAIPanelStore(
    (state) => state.setSelectedConversationId
  );

  const treeNodes = useTreeStore((state) => state.nodes);
  const selectPage = useTreeStore((state) => state.selectPage);
  const setSection = useAppStore((state) => state.setSection);
  const section = useAppStore((state) => state.section);
  const setAgentSettingsReturnSection = useAppStore(
    (state) => state.setAgentSettingsReturnSection
  );
  const seedAgentCreationDraft = useAgentCreationDraftStore(
    (state) => state.seedFromConversation
  );

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [hasLoadedConversations, setHasLoadedConversations] = useState(false);
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [submitting, setSubmitting] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("messages");
  const [proposalActionPending, setProposalActionPending] = useState<
    "decline" | "restore" | null
  >(null);

  const allPages = useMemo(() => flattenTree(treeNodes), [treeNodes]);
  const { detail, loading: detailLoading, error: detailError, setDetail } =
    useConversationThread(selectedConversationId);

  const refreshConversations = useCallback(async () => {
    if (!hasLoadedConversations) {
      setConversationsLoading(true);
    }

    const nextConversations = await listAgentConversations({
      agentSlug: activeAgentSlug,
      limit: 100,
    }).catch(() => null);

    if (nextConversations) {
      setConversations(nextConversations);
    }

    setConversationsLoading(false);
    setHasLoadedConversations(true);
  }, [activeAgentSlug, hasLoadedConversations]);

  const refreshAgents = useCallback(async () => {
    const personas = await listAgentPersonas().catch(() => null);
    if (!personas) return;

    const generalRunning =
      conversations.filter(
        (conversation) =>
          conversation.agentSlug === "general" && conversation.status === "running"
      ).length || 0;

    setAgents([
      { ...GENERAL_AGENT, runningCount: generalRunning },
      ...personas.map((persona) => ({
        name: persona.name,
        slug: persona.slug,
        emoji: persona.emoji || "",
        role: persona.role || "",
        active: persona.active,
        runningCount: persona.runningCount,
      })),
    ]);
  }, [conversations]);

  useEffect(() => {
    setConversationsLoading(true);
    setHasLoadedConversations(false);
  }, [activeAgentSlug]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshConversations();
      void refreshAgents();
    }, 3000);
    return () => window.clearInterval(interval);
  }, [refreshAgents, refreshConversations]);

  useEffect(() => {
    setDetailTab("messages");
    setProposalActionPending(null);
  }, [selectedConversationId]);

  useEffect(() => {
    if (!detail?.meta) return;
    mergeConversationMeta(detail.meta);
  }, [detail?.meta]);

  const orderedAgents = useMemo(
    () =>
      [...agents].sort((a, b) => {
        if (a.slug === "general") return -1;
        if (b.slug === "general") return 1;
        if (a.slug === "editor") return -1;
        if (b.slug === "editor") return 1;
        return a.name.localeCompare(b.name);
      }),
    [agents]
  );

  const activeAgent = activeAgentSlug
    ? orderedAgents.find((agent) => agent.slug === activeAgentSlug) || null
    : null;
  const listSelectedConversationMeta = conversations.find(
    (conversation) => conversation.id === selectedConversationId
  );
  const selectedConversationMeta =
    detail?.meta.id === selectedConversationId ? detail.meta : listSelectedConversationMeta;
  const selectedConversationAgent = selectedConversationMeta
    ? orderedAgents.find((agent) => agent.slug === selectedConversationMeta.agentSlug) ||
      null
    : null;
  const selectedDetailStatus = detailStatusBadge(detail);
  const selectedStructuredBadge = selectedConversationMeta
    ? structuredFeedBadge(selectedConversationMeta)
    : null;
  const visibleConversations = filterConversations(conversations, viewFilter);
  const composerAgent = selectedConversationMeta
    ? {
        slug: selectedConversationMeta.agentSlug,
        name:
          selectedConversationAgent?.name || selectedConversationMeta.agentSlug,
      }
    : activeAgent
      ? { slug: activeAgent.slug, name: activeAgent.name }
      : null;

  useEffect(() => {
    if (detailTab !== "terminal") return;
    if (selectedConversationMeta?.status === "running") return;
    setDetailTab("messages");
  }, [detailTab, selectedConversationMeta?.status]);

  function openAgentSettings(agentSlug: string) {
    if (section.view !== "settings") {
      setAgentSettingsReturnSection(section);
    }
    close();
    setSection({
      type: "agent",
      slug: agentSlug,
      view: "settings",
      settingsTarget: agentSlug,
    });
  }

  function openManageAgents() {
    if (section.view !== "settings") {
      setAgentSettingsReturnSection(section);
    }
    close();
    setSection({ type: "agents", view: "settings", settingsTarget: "directory" });
  }

  function openCreateAgent() {
    if (section.view !== "settings") {
      setAgentSettingsReturnSection(section);
    }
    close();
    setSection({ type: "agents", view: "settings", settingsTarget: "__new__" });
  }

  function mergeConversationMeta(nextMeta: ConversationMeta) {
    setConversations((current) => {
      const hasConversation = current.some((conversation) => conversation.id === nextMeta.id);
      if (!hasConversation) {
        return [nextMeta, ...current];
      }
      return current.map((conversation) =>
        conversation.id === nextMeta.id ? nextMeta : conversation
      );
    });
  }

  async function submitConversation(input: {
    userMessage: string;
    mentionedPaths: string[];
  }) {
    if (!composerAgent) return;

    setSubmitting(true);
    try {
      const conversation = await createManualConversation({
        agentSlug: composerAgent.slug,
        userMessage: input.userMessage,
        mentionedPaths: input.mentionedPaths,
      });
      mergeConversationMeta(conversation);
      setSelectedConversationId(conversation.id);
      await refreshConversations();
    } finally {
      setSubmitting(false);
    }
  }

  async function updateProposal(action: "decline" | "restore", conversationId: string) {
    setProposalActionPending(action);
    try {
      const updated = await patchConversationProposal(
        conversationId,
        action === "decline"
          ? "decline_agent_proposal"
          : "restore_agent_proposal"
      );
      setDetail(updated);
      mergeConversationMeta(updated.meta);
    } finally {
      setProposalActionPending(null);
    }
  }

  function openArtifact(path: string) {
    selectPage(path);
    setSection({ type: "page" });
  }

  function acceptProposal(draft: AgentPersonaDraft, conversationId: string) {
    if (section.view !== "settings") {
      setAgentSettingsReturnSection(section);
    }
    seedAgentCreationDraft(draft, conversationId);
    close();
    setSection({ type: "agents", view: "settings", settingsTarget: "__new__" });
  }

  return (
    <>
      <div className="shrink-0 border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-2">
            {selectedConversationMeta ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className="-ml-1"
                onClick={() => setSelectedConversationId(null)}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : (
              <Bot className="h-4 w-4 shrink-0 text-primary" />
            )}
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold tracking-[-0.02em]">
                {selectedConversationMeta ? "Conversation" : "Agent Chats"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {selectedConversationMeta
                  ? selectedConversationMeta.title
                  : activeAgent
                    ? activeAgent.name
                    : "Inbox across your team"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {selectedConversationMeta ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => openAgentSettings(selectedConversationMeta.agentSlug)}
                title="Open agent settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            ) : activeAgent ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => openAgentSettings(activeAgent.slug)}
                title="Open agent settings"
              >
                <Settings className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={openCreateAgent}
                  title="Create agent"
                >
                  <Plus data-icon="inline-start" className="h-3.5 w-3.5" />
                  New
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1.5 px-2 text-[11px]"
                  onClick={openManageAgents}
                  title="Manage agents"
                >
                  <Settings data-icon="inline-start" className="h-3.5 w-3.5" />
                  Manage
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon-sm" onClick={close}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {selectedConversationMeta ? (
        <div className="flex min-h-0 flex-1 flex-col bg-background motion-safe:animate-in motion-safe:fade-in-0 duration-200">
          <div className="shrink-0 border-b border-border/70 bg-background/95 px-3 py-3 backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <AgentAvatar
                name={selectedConversationAgent?.name}
                slug={selectedConversationMeta.agentSlug}
                size="md"
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px]",
                      TRIGGER_STYLES[selectedConversationMeta.trigger]
                    )}
                  >
                    {TRIGGER_LABELS[selectedConversationMeta.trigger]}
                  </span>
                  {selectedStructuredBadge ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        selectedStructuredBadge.className
                      )}
                    >
                      {selectedStructuredBadge.label}
                    </span>
                  ) : null}
                  {selectedDetailStatus ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px]",
                        selectedDetailStatus.className
                      )}
                    >
                      {selectedDetailStatus.label}
                    </span>
                  ) : null}
                  <span className="text-[11px] text-muted-foreground">
                    {selectedConversationMeta.status}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatRelative(selectedConversationMeta.startedAt)}
                  </span>
                </div>
                {detail?.artifacts?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {detail.artifacts.map((artifact) => (
                      <button
                        key={artifact.path}
                        onClick={() => openArtifact(artifact.path)}
                        className="rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        {artifact.label || artifact.path}
                      </button>
                    ))}
                  </div>
                ) : null}
                {detail?.thread.source === "structured_session" ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {selectedDetailStatus?.detail ||
                      "Structured live feed active. Transcript and terminal remain available as fallbacks."}
                  </p>
                ) : null}
                {detailError ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">{detailError}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-full bg-muted/40 p-1 w-fit">
              {([
                "messages",
                "transcript",
                ...(selectedConversationMeta.status === "running"
                  ? (["terminal"] as DetailTab[])
                  : []),
              ] as DetailTab[]).map((tab) => (
                <Button
                  key={tab}
                  variant={detailTab === tab ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 rounded-full px-3 text-[11px] capitalize shadow-none"
                  onClick={() => setDetailTab(tab)}
                >
                  {tab === "messages"
                    ? detail?.thread.source === "structured_session" &&
                      selectedConversationMeta.status === "running"
                      ? "Live"
                      : "Messages"
                    : tab === "transcript"
                      ? detail?.thread.source === "structured_session"
                        ? "Raw transcript"
                        : "Transcript"
                      : "Terminal"}
                </Button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {detailTab === "messages" ? (
              <div className="h-full motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 duration-200">
                <ConversationThreadView
                  detail={detail}
                  loading={detailLoading}
                  proposalActionPending={proposalActionPending}
                  onArtifactClick={openArtifact}
                  onAcceptProposal={acceptProposal}
                  onDeclineProposal={(conversationId) => updateProposal("decline", conversationId)}
                  onRestoreProposal={(conversationId) => updateProposal("restore", conversationId)}
                  onOpenCreatedAgent={openAgentSettings}
                />
              </div>
            ) : detailTab === "terminal" ? (
              <div className="h-full motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 duration-200">
                <WebTerminal
                  sessionId={selectedConversationMeta.id}
                  displayPrompt={selectedConversationMeta.title}
                  reconnect
                  onClose={() => void refreshConversations()}
                />
              </div>
            ) : detail ? (
              <ScrollArea className="h-full bg-muted/10 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 duration-200">
                <div className="min-h-full p-4">
                  {selectedConversationMeta.status === "running" ? (
                    <p className="mb-3 text-[11px] text-muted-foreground">
                      Transcript may lag behind the live run while the agent is still working.
                    </p>
                  ) : null}
                  <pre className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-foreground/85">
                    {replacePastedTextNotice(
                      detail.transcript || "No transcript captured.",
                      selectedConversationMeta.title
                    )}
                  </pre>
                </div>
              </ScrollArea>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading transcript...
              </div>
            )}
          </div>

          <ConversationComposer
            agent={composerAgent}
            allPages={allPages}
            submitting={submitting}
            onSubmit={submitConversation}
          />
        </div>
      ) : (
        <>
          <div className="shrink-0 border-b border-border px-3 py-3">
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "min-w-0 flex-1 justify-between px-3 text-[12px] font-normal"
                  )}
                >
                  <span className="truncate">
                    {activeAgent ? activeAgent.name : "All agents"}
                  </span>
                  <ChevronDown data-icon="inline-end" />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuGroup>
                    <DropdownMenuItem onClick={() => setActiveAgentSlug(null)}>
                      <span className="flex-1">All agents</span>
                      {!activeAgentSlug ? (
                        <span className="text-[10px] text-muted-foreground">Selected</span>
                      ) : null}
                    </DropdownMenuItem>
                    {orderedAgents.map((agent) => (
                      <DropdownMenuItem
                        key={agent.slug}
                        onClick={() => setActiveAgentSlug(agent.slug)}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <AgentAvatar name={agent.name} slug={agent.slug} size="xs" />
                          <span className="truncate">{agent.name}</span>
                        </span>
                        {activeAgentSlug === agent.slug ? (
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            Selected
                          </span>
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <div className="mt-2 flex items-center gap-1">
              <FilterChip active={viewFilter === "all"} onClick={() => setViewFilter("all")}>
                All
              </FilterChip>
              <FilterChip
                active={viewFilter === "running"}
                onClick={() => setViewFilter("running")}
              >
                Running
              </FilterChip>
              <FilterChip
                active={viewFilter === "failed"}
                onClick={() => setViewFilter("failed")}
              >
                Failed
              </FilterChip>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1 bg-muted/10">
            <div className="flex flex-col gap-2 p-2.5">
              {conversationsLoading && visibleConversations.length > 0 ? (
                <div className="flex items-center gap-2 px-2 py-6 text-[12px] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading conversations...
                </div>
              ) : !hasLoadedConversations && visibleConversations.length === 0 ? (
                <div className="px-2 py-8" />
              ) : visibleConversations.length === 0 ? (
                <div className="px-2 py-6 text-[12px] text-muted-foreground">
                  {activeAgent
                    ? `No conversations yet for ${activeAgent.name}.`
                    : "No conversations match this view."}
                </div>
              ) : (
                visibleConversations.map((conversation) => {
                  const agent =
                    orderedAgents.find((entry) => entry.slug === conversation.agentSlug) || null;
                  const badge = proposalBadge(conversation);
                  const liveBadge = structuredFeedBadge(conversation);
                  return (
                    <button
                      key={conversation.id}
                      onClick={() => setSelectedConversationId(conversation.id)}
                      className={cn(
                        "w-full rounded-2xl border px-3.5 py-3 text-left shadow-sm transition-all duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1",
                        selectedConversationId === conversation.id
                          ? "border-primary/30 bg-primary/5 shadow-primary/5"
                          : "border-border/70 bg-background/85 hover:bg-accent/30"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div className="mt-0.5 shrink-0">
                          {conversation.status === "running" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                          ) : conversation.status === "failed" ? (
                            <XCircle className="h-3.5 w-3.5 text-destructive" />
                          ) : conversation.status === "cancelled" ? (
                            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
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
                            {liveBadge ? (
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[10px]",
                                  liveBadge.className
                                )}
                              >
                                {liveBadge.label}
                              </span>
                            ) : null}
                            {badge ? (
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[10px]",
                                  badge.className
                                )}
                              >
                                {badge.label}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {agent?.name || conversation.agentSlug} · {formatRelative(conversation.startedAt)}
                          </p>
                          {conversation.summary ? (
                            <p
                              className={cn(
                                "mt-1 truncate text-[11px]",
                                conversation.runtimeSession?.eventStreamFormat &&
                                  conversation.status === "running"
                                  ? "text-foreground/80"
                                  : "text-muted-foreground/75"
                              )}
                            >
                              {conversation.summary}
                            </p>
                          ) : conversation.runtimeSession?.eventStreamFormat &&
                            conversation.status === "running" ? (
                            <p className="mt-1 truncate text-[11px] text-foreground/80">
                              Live structured session
                            </p>
                          ) : null}
                          {conversation.artifactPaths.length > 0 ? (
                            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground/70">
                              <FileText className="h-3 w-3" />
                              <span>
                                {conversation.artifactPaths.length} artifact
                                {conversation.artifactPaths.length === 1 ? "" : "s"}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </ScrollArea>

          <ConversationComposer
            agent={composerAgent}
            allPages={allPages}
            submitting={submitting}
            onSubmit={submitConversation}
          />
        </>
      )}
    </>
  );
}
