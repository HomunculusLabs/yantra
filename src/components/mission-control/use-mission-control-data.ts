"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAgentPersona,
  generateAgentDraftFromDescription,
  getCompanyConfig,
  getSchedulerStatus,
  importAgentBundle,
  listAgentPersonas,
  listAgentTasks,
  listSlackMessages,
  runAgentPersona,
  toggleAgentPersona,
  updateScheduler,
} from "@/lib/api/agents-client";
import type { AgentSummary, CreateAgentPersonaRequest } from "@/types/agent-api";

const EMPTY_STATE = {
  agents: [] as AgentSummary[],
  alertCount: 0,
  companyName: "",
  schedulerRunning: false,
  scheduledCount: 0,
};

type RefreshOptions = {
  resetLoading?: boolean;
};

function buildAgentDraft(
  description: string,
  draft: Partial<CreateAgentPersonaRequest>
): CreateAgentPersonaRequest | null {
  const name = draft.name?.trim();
  if (!name) return null;

  const department = draft.department || "general";
  return {
    slug:
      draft.slug?.trim() ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    name,
    role: draft.role?.trim() || "",
    emoji: draft.emoji?.trim() || "",
    department,
    type: draft.type || "specialist",
    heartbeat: "0 */4 * * *",
    workspace: "workspace",
    provider: "claude-code",
    budget: 200,
    active: false,
    workdir: "/data",
    focus: [],
    tags: [department],
    channels:
      department === "general" ? ["general"] : [department, "general"],
    body: draft.body || `You are ${name}. ${draft.role || description.trim()}`,
  };
}

export function useMissionControlData() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [alertCount, setAlertCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [nlGenerating, setNlGenerating] = useState(false);
  const [schedulerRunning, setSchedulerRunning] = useState(false);
  const [schedulerToggling, setSchedulerToggling] = useState(false);
  const [scheduledCount, setScheduledCount] = useState(0);
  const [companyName, setCompanyName] = useState("");

  const requestRef = useRef(0);
  const stateRef = useRef(EMPTY_STATE);

  const refresh = useCallback(async (options?: RefreshOptions) => {
    const requestId = ++requestRef.current;
    if (options?.resetLoading) {
      setLoading(true);
    }

    const previous = stateRef.current;

    const [
      personasResult,
      alertsResult,
      tasksResult,
      schedulerResult,
      generalResult,
      companyResult,
    ] = await Promise.allSettled([
      listAgentPersonas(),
      listSlackMessages({ channel: "alerts", limit: 100 }),
      listAgentTasks({ all: true, status: "pending" }),
      getSchedulerStatus(),
      listSlackMessages({ channel: "general", limit: 50 }),
      getCompanyConfig(),
    ]);

    if (requestRef.current !== requestId) return;

    const baseAgents =
      personasResult.status === "fulfilled" ? personasResult.value : previous.agents;

    const pendingCounts = new Map<string, number>();
    if (tasksResult.status === "fulfilled") {
      for (const task of tasksResult.value) {
        pendingCounts.set(task.toAgent, (pendingCounts.get(task.toAgent) || 0) + 1);
      }
    }

    const previousBySlug = new Map(previous.agents.map((agent) => [agent.slug, agent]));
    const lastActions = new Map<string, string>();
    if (generalResult.status === "fulfilled") {
      for (const message of generalResult.value) {
        if (message.agent && message.agent !== "human" && message.agent !== "system") {
          lastActions.set(message.agent, message.content?.slice(0, 100) || "");
        }
      }
    }

    const nextAgents = baseAgents.map((agent) => {
      const previousAgent = previousBySlug.get(agent.slug);
      return {
        ...agent,
        pendingTasks:
          tasksResult.status === "fulfilled"
            ? pendingCounts.get(agent.slug) || 0
            : previousAgent?.pendingTasks || 0,
        lastAction:
          generalResult.status === "fulfilled"
            ? lastActions.get(agent.slug) || undefined
            : previousAgent?.lastAction,
      };
    });

    const nextState = {
      agents: nextAgents,
      alertCount:
        alertsResult.status === "fulfilled"
          ? alertsResult.value.length
          : previous.alertCount,
      companyName:
        companyResult.status === "fulfilled"
          ? companyResult.value.companyName
          : previous.companyName,
      schedulerRunning:
        schedulerResult.status === "fulfilled"
          ? schedulerResult.value.status === "running"
          : previous.schedulerRunning,
      scheduledCount:
        schedulerResult.status === "fulfilled"
          ? schedulerResult.value.scheduledAgents?.length || 0
          : previous.scheduledCount,
    };

    stateRef.current = nextState;
    setAgents(nextState.agents);
    setAlertCount(nextState.alertCount);
    setCompanyName(nextState.companyName);
    setSchedulerRunning(nextState.schedulerRunning);
    setScheduledCount(nextState.scheduledCount);
    setLoading(false);
  }, []);

  const runSchedulerAction = useCallback(
    async (action: "start-all" | "stop-all") => {
      setSchedulerToggling(true);
      try {
        await updateScheduler({ action });
      } catch {
        // preserve silent failure behavior
      } finally {
        setSchedulerToggling(false);
        await refresh();
      }
    },
    [refresh]
  );

  const toggleAgent = useCallback(
    async (slug: string) => {
      try {
        await toggleAgentPersona(slug);
      } catch {
        // preserve silent failure behavior
      } finally {
        await refresh();
      }
    },
    [refresh]
  );

  const runAgent = useCallback(
    async (slug: string) => {
      try {
        const agent = stateRef.current.agents.find((item) => item.slug === slug);
        if (agent && !agent.active) {
          await toggleAgentPersona(slug);
        }
        await runAgentPersona(slug);
      } catch {
        // preserve silent failure behavior
      } finally {
        await refresh();
      }
    },
    [refresh]
  );

  const bulkToggleDepartment = useCallback(
    async (slugs: string[], action: "activate" | "pause") => {
      try {
        await updateScheduler({ action, slugs });
      } catch {
        // preserve silent failure behavior
      } finally {
        await refresh();
      }
    },
    [refresh]
  );

  const createAgentFromDescription = useCallback(
    async (description: string) => {
      if (!description.trim()) return false;
      setNlGenerating(true);
      try {
        const draft = await generateAgentDraftFromDescription(description);
        if (!draft) return false;
        const payload = buildAgentDraft(description, draft);
        if (!payload) return false;
        await createAgentPersona(payload);
        await refresh();
        return true;
      } catch {
        return false;
      } finally {
        setNlGenerating(false);
      }
    },
    [refresh]
  );

  const importBundle = useCallback(
    async (bundle: unknown) => {
      try {
        await importAgentBundle(bundle);
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh]
  );

  useEffect(() => {
    void refresh({ resetLoading: true });
  }, [refresh]);

  useEffect(() => {
    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource("/api/agents/events");
      eventSource.addEventListener("agent_status", (event) => {
        try {
          const statuses = JSON.parse(event.data) as Array<{
            slug: string;
            active: boolean;
            running?: boolean;
            lastHeartbeat?: string;
            nextHeartbeat?: string;
          }>;
          setAgents((previous) => {
            const next = previous.map((agent) => {
              const status = statuses.find((item) => item.slug === agent.slug);
              if (!status) return agent;
              return {
                ...agent,
                active: status.active,
                running: status.running,
                lastHeartbeat: status.lastHeartbeat,
                nextHeartbeat: status.nextHeartbeat,
              };
            });
            stateRef.current = { ...stateRef.current, agents: next };
            return next;
          });
        } catch {
          // ignore parse errors
        }
      });

      eventSource.addEventListener("pulse", (event) => {
        try {
          const pulse = JSON.parse(event.data) as { scheduledAgents?: number };
          const nextSchedulerRunning = (pulse.scheduledAgents || 0) > 0;
          const nextScheduledCount = pulse.scheduledAgents || 0;
          setSchedulerRunning(nextSchedulerRunning);
          setScheduledCount(nextScheduledCount);
          stateRef.current = {
            ...stateRef.current,
            schedulerRunning: nextSchedulerRunning,
            scheduledCount: nextScheduledCount,
          };
        } catch {
          // ignore parse errors
        }
      });

      eventSource.addEventListener("agent_responding", (event) => {
        try {
          const agents = JSON.parse(event.data);
          window.dispatchEvent(
            new CustomEvent("yantra:agent-responding", { detail: agents })
          );
        } catch {
          // ignore parse errors
        }
      });

      eventSource.addEventListener("slack_activity", (event) => {
        window.dispatchEvent(new CustomEvent("yantra:slack-refresh"));
        try {
          const data = JSON.parse(event.data) as {
            channel?: string;
            preview?: string;
            agentName?: string;
            hasHumanMention?: boolean;
          };
          if ("Notification" in window && Notification.permission === "granted") {
            if (data.channel === "alerts" && data.preview) {
              new Notification("Yantra Alert", {
                body: `${data.agentName || "Agent"}: ${data.preview}`,
                icon: "/favicon.ico",
                tag: `yantra-alert-${Date.now()}`,
              });
            } else if (data.hasHumanMention && data.preview) {
              new Notification("Agent needs your attention", {
                body: `${data.agentName || "Agent"} in #${data.channel}: ${data.preview}`,
                icon: "/favicon.ico",
                tag: `yantra-mention-${Date.now()}`,
              });
            }
          }
        } catch {
          // ignore parse errors
        }
      });
    } catch {
      // EventSource unavailable; polling below is the fallback.
    }

    const interval = window.setInterval(() => {
      void refresh();
    }, 30000);

    return () => {
      window.clearInterval(interval);
      eventSource?.close();
    };
  }, [refresh]);

  return {
    agents,
    alertCount,
    loading,
    nlGenerating,
    schedulerRunning,
    schedulerToggling,
    scheduledCount,
    companyName,
    loadAgents: refresh,
    runSchedulerAction,
    toggleAgent,
    runAgent,
    bulkToggleDepartment,
    createAgentFromDescription,
    importBundle,
  };
}
