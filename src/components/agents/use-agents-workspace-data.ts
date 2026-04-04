"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  getAgentPersona,
  getConversationDetail,
  listAgentConversations,
  listAgentJobs,
  listAgentPersonas,
} from "@/lib/api/agents-client";
import {
  GENERAL_AGENT,
  statusFromFilter,
  triggerFromFilter,
  type StatusFilter,
  type TriggerFilter,
} from "@/components/agents/agents-workspace.helpers";
import type { AgentSummary } from "@/types/agent-api";
import type { ConversationDetail, ConversationMeta } from "@/types/conversations";
import type { JobConfig } from "@/types/jobs";

type UseAgentsWorkspaceDataArgs = {
  activeAgentSlug: string | null;
  triggerFilter: TriggerFilter;
  statusFilter: StatusFilter;
  selectedConversationId: string | null;
  settingsAgentSlug: string | null;
};

type UseAgentsWorkspaceDataResult = {
  agents: AgentSummary[];
  conversations: ConversationMeta[];
  conversationsLoading: boolean;
  hasLoadedConversations: boolean;
  selectedConversation: ConversationDetail | null;
  settingsPersona: AgentSummary | null;
  setSettingsPersona: Dispatch<SetStateAction<AgentSummary | null>>;
  settingsBody: string;
  setSettingsBody: Dispatch<SetStateAction<string>>;
  settingsJobs: JobConfig[];
  refreshAgents: () => Promise<void>;
  refreshConversations: (options?: { resetLoading?: boolean }) => Promise<void>;
  refreshSettings: (slug: string) => Promise<void>;
  refreshSelectedConversation: (id: string) => Promise<void>;
};

export function useAgentsWorkspaceData({
  activeAgentSlug,
  triggerFilter,
  statusFilter,
  selectedConversationId,
  settingsAgentSlug,
}: UseAgentsWorkspaceDataArgs): UseAgentsWorkspaceDataResult {
  const [personas, setPersonas] = useState<AgentSummary[]>([]);
  const [conversations, setConversations] = useState<ConversationMeta[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [hasLoadedConversations, setHasLoadedConversations] = useState(false);
  const [selectedConversation, setSelectedConversation] =
    useState<ConversationDetail | null>(null);
  const [settingsPersona, setSettingsPersona] = useState<AgentSummary | null>(null);
  const [settingsBody, setSettingsBody] = useState("");
  const [settingsJobs, setSettingsJobs] = useState<JobConfig[]>([]);

  const personasRequestRef = useRef(0);
  const conversationsRequestRef = useRef(0);
  const settingsRequestRef = useRef(0);
  const conversationDetailRequestRef = useRef(0);

  const agents = useMemo(() => {
    const generalRunning =
      conversations.filter(
        (conversation) =>
          conversation.agentSlug === "general" &&
          conversation.status === "running"
      ).length || 0;

    return [
      { ...GENERAL_AGENT, runningCount: generalRunning },
      ...[...personas].sort((a, b) => {
        if (a.slug === "editor") return -1;
        if (b.slug === "editor") return 1;
        return a.name.localeCompare(b.name);
      }),
    ];
  }, [conversations, personas]);

  const refreshAgents = useCallback(async () => {
    const requestId = ++personasRequestRef.current;

    try {
      const nextPersonas = await listAgentPersonas();
      if (personasRequestRef.current !== requestId) return;
      setPersonas(nextPersonas);
    } catch {}
  }, []);

  const refreshConversations = useCallback(
    async (options?: { resetLoading?: boolean }) => {
      const requestId = ++conversationsRequestRef.current;

      if (options?.resetLoading || !hasLoadedConversations) {
        setConversationsLoading(true);
      }

      try {
        const nextConversations = await listAgentConversations({
          agentSlug: activeAgentSlug,
          trigger: triggerFromFilter(triggerFilter),
          status: statusFromFilter(statusFilter),
          limit: 200,
        });

        if (conversationsRequestRef.current !== requestId) return;
        setConversations(nextConversations);
      } catch {
      } finally {
        if (conversationsRequestRef.current === requestId) {
          setConversationsLoading(false);
          setHasLoadedConversations(true);
        }
      }
    },
    [activeAgentSlug, hasLoadedConversations, statusFilter, triggerFilter]
  );

  const refreshSettings = useCallback(async (slug: string) => {
    const requestId = ++settingsRequestRef.current;

    if (slug === "general") {
      setSettingsPersona(GENERAL_AGENT);
      setSettingsBody("");
      setSettingsJobs([]);
      return;
    }

    const [personaResult, jobsResult] = await Promise.allSettled([
      getAgentPersona(slug),
      listAgentJobs(slug),
    ]);

    if (settingsRequestRef.current !== requestId) return;

    if (personaResult.status === "fulfilled") {
      setSettingsPersona(personaResult.value);
      setSettingsBody(personaResult.value.body || "");
    }

    if (jobsResult.status === "fulfilled") {
      setSettingsJobs(jobsResult.value);
    } else {
      setSettingsJobs([]);
    }
  }, []);

  const refreshSelectedConversation = useCallback(async (id: string) => {
    const requestId = ++conversationDetailRequestRef.current;

    try {
      const detail = await getConversationDetail(id);
      if (conversationDetailRequestRef.current !== requestId) return;
      setSelectedConversation(detail);
    } catch {}
  }, []);

  useEffect(() => {
    setHasLoadedConversations(false);
    setConversationsLoading(true);
    void refreshConversations({ resetLoading: true });
  }, [refreshConversations]);

  useEffect(() => {
    void refreshAgents();
  }, [refreshAgents]);

  useEffect(() => {
    const interval = setInterval(() => {
      void Promise.allSettled([refreshConversations(), refreshAgents()]);
    }, 3000);

    return () => clearInterval(interval);
  }, [refreshAgents, refreshConversations]);

  useEffect(() => {
    if (!settingsAgentSlug) {
      settingsRequestRef.current += 1;
      setSettingsPersona(null);
      setSettingsBody("");
      setSettingsJobs([]);
      return;
    }

    void refreshSettings(settingsAgentSlug);
  }, [refreshSettings, settingsAgentSlug]);

  useEffect(() => {
    if (!selectedConversationId) {
      conversationDetailRequestRef.current += 1;
      setSelectedConversation(null);
      return;
    }

    const current = conversations.find(
      (conversation) => conversation.id === selectedConversationId
    );

    if (current && current.status !== "running") {
      void refreshSelectedConversation(selectedConversationId);
    }
  }, [conversations, refreshSelectedConversation, selectedConversationId]);

  return {
    agents,
    conversations,
    conversationsLoading,
    hasLoadedConversations,
    selectedConversation,
    settingsPersona,
    setSettingsPersona,
    settingsBody,
    setSettingsBody,
    settingsJobs,
    refreshAgents,
    refreshConversations,
    refreshSettings,
    refreshSelectedConversation,
  };
}
