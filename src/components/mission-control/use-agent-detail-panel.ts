"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAgentPersona,
  getAgentDetail,
  getAgentExportBundle,
  getAgentSessionOutput,
  getAgentWorkspace,
  listAgentTasks,
  listSlackMessages,
  runAgentPersona,
  toggleAgentPersona,
  updateAgentTask,
} from "@/lib/api/agents-client";
import type {
  AgentDetailPersona,
  AgentGoalHistory,
  AgentHeartbeatRecord,
  AgentWorkspaceFile,
  AgentExportBundle,
} from "@/types/agent-api";
import type { AgentTask, SlackMessage } from "@/types/agents";

type RefreshOptions = {
  resetLoading?: boolean;
};

function getLatestHistoryTimestamp(history: AgentHeartbeatRecord[]): string | null {
  if (history.length === 0) return null;
  return history.reduce<string | null>((latest, entry) => {
    if (!latest) return entry.timestamp;
    return new Date(entry.timestamp).getTime() > new Date(latest).getTime()
      ? entry.timestamp
      : latest;
  }, null);
}

export function useAgentDetailPanel(slug: string) {
  const [agent, setAgent] = useState<AgentDetailPersona | null>(null);
  const [history, setHistory] = useState<AgentHeartbeatRecord[]>([]);
  const [slackMessages, setSlackMessages] = useState<SlackMessage[]>([]);
  const [memory, setMemory] = useState("");
  const [memoryFiles, setMemoryFiles] = useState<Record<string, string>>({});
  const [workspace, setWorkspace] = useState<AgentWorkspaceFile[]>([]);
  const [goalHistory, setGoalHistory] = useState<AgentGoalHistory>({});
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [runningHeartbeat, setRunningHeartbeat] = useState(false);
  const [sessionOutputs, setSessionOutputs] = useState<Record<string, string>>({});

  const requestRef = useRef(0);
  const inFlightSessionOutputsRef = useRef(new Set<string>());
  const pollIntervalRef = useRef<number | null>(null);
  const pollTimeoutRef = useRef<number | null>(null);
  const historyRef = useRef<AgentHeartbeatRecord[]>([]);
  const agentRef = useRef<AgentDetailPersona | null>(null);

  const clearRunTimers = useCallback(() => {
    if (pollIntervalRef.current !== null) {
      window.clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (pollTimeoutRef.current !== null) {
      window.clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const stopRunPolling = useCallback(() => {
    clearRunTimers();
    setRunningHeartbeat(false);
  }, [clearRunTimers]);

  const refresh = useCallback(
    async (options?: RefreshOptions) => {
      const requestId = ++requestRef.current;
      if (options?.resetLoading) {
        setLoading(true);
      }

      const [detailResult, workspaceResult, slackResult, tasksResult] =
        await Promise.allSettled([
          getAgentDetail(slug),
          getAgentWorkspace(slug),
          listSlackMessages({ limit: 100 }),
          listAgentTasks({ agent: slug }),
        ]);

      if (requestRef.current !== requestId) return;

      if (detailResult.status === "fulfilled") {
        const detail = detailResult.value;
        setAgent(detail.persona);
        agentRef.current = detail.persona;
        setHistory(detail.history || []);
        historyRef.current = detail.history || [];
        setGoalHistory(detail.goalHistory || {});
        const nextMemoryFiles = detail.memory || {};
        setMemoryFiles(nextMemoryFiles);
        setMemory(nextMemoryFiles["context.md"] || nextMemoryFiles["notes.md"] || "");
      }

      if (workspaceResult.status === "fulfilled") {
        setWorkspace(workspaceResult.value || []);
      }

      if (slackResult.status === "fulfilled") {
        const agentMessages = slackResult.value.filter((message) => message.agent === slug);
        setSlackMessages(agentMessages.slice(-20));
      }

      if (tasksResult.status === "fulfilled") {
        setTasks(tasksResult.value || []);
      }

      setLoading(false);
    },
    [slug]
  );

  const ensureSessionOutputLoaded = useCallback(
    async (sessionTs: string) => {
      const key = `hb-${sessionTs}`;
      if (sessionOutputs[key] || inFlightSessionOutputsRef.current.has(key)) {
        return;
      }

      inFlightSessionOutputsRef.current.add(key);
      try {
        const output = await getAgentSessionOutput(slug, sessionTs);
        if (output) {
          setSessionOutputs((previous) => ({ ...previous, [key]: output }));
        }
      } catch {
        // preserve silent failure behavior
      } finally {
        inFlightSessionOutputsRef.current.delete(key);
      }
    },
    [sessionOutputs, slug]
  );

  const toggleActive = useCallback(async () => {
    setToggling(true);
    try {
      await toggleAgentPersona(slug);
    } catch {
      // preserve silent failure behavior
    } finally {
      setToggling(false);
      await refresh();
    }
  }, [refresh, slug]);

  const runHeartbeat = useCallback(async () => {
    const baselineTimestamp = getLatestHistoryTimestamp(historyRef.current);
    setRunningHeartbeat(true);
    clearRunTimers();

    try {
      if (agentRef.current && !agentRef.current.active) {
        await toggleAgentPersona(slug);
      }
      await runAgentPersona(slug);

      pollIntervalRef.current = window.setInterval(() => {
        void refresh().then(() => {
          const latestTimestamp = getLatestHistoryTimestamp(historyRef.current);
          if (latestTimestamp && latestTimestamp !== baselineTimestamp) {
            stopRunPolling();
            void ensureSessionOutputLoaded(latestTimestamp);
          }
        });
      }, 3000);

      pollTimeoutRef.current = window.setTimeout(() => {
        stopRunPolling();
        void refresh();
      }, 300000);
    } catch {
      stopRunPolling();
    }
  }, [clearRunTimers, ensureSessionOutputLoaded, refresh, slug, stopRunPolling]);

  const deleteAgent = useCallback(async () => {
    try {
      await deleteAgentPersona(slug);
      return true;
    } catch {
      return false;
    }
  }, [slug]);

  const exportBundle = useCallback(async (): Promise<AgentExportBundle | null> => {
    try {
      return await getAgentExportBundle(slug);
    } catch {
      return null;
    }
  }, [slug]);

  const updateTaskStatus = useCallback(
    async (taskId: string, status: AgentTask["status"], result?: string) => {
      try {
        await updateAgentTask({ agent: slug, taskId, status, result });
      } catch {
        // preserve silent failure behavior
      } finally {
        await refresh();
      }
    },
    [refresh, slug]
  );

  useEffect(() => {
    setLoading(true);
    setAgent(null);
    agentRef.current = null;
    setHistory([]);
    historyRef.current = [];
    setSlackMessages([]);
    setMemory("");
    setMemoryFiles({});
    setWorkspace([]);
    setGoalHistory({});
    setTasks([]);
    setSessionOutputs({});
    inFlightSessionOutputsRef.current.clear();
    stopRunPolling();
    void refresh({ resetLoading: true });
  }, [refresh, stopRunPolling]);

  useEffect(() => {
    const latestHeartbeat = history[0]?.timestamp;
    if (latestHeartbeat) {
      void ensureSessionOutputLoaded(latestHeartbeat);
    }
  }, [ensureSessionOutputLoaded, history]);

  useEffect(() => stopRunPolling, [stopRunPolling]);

  return {
    agent,
    history,
    slackMessages,
    memory,
    memoryFiles,
    workspace,
    goalHistory,
    tasks,
    loading,
    toggling,
    runningHeartbeat,
    sessionOutputs,
    refresh,
    toggleActive,
    runHeartbeat,
    deleteAgent,
    exportBundle,
    updateTaskStatus,
    ensureSessionOutputLoaded,
    stopRunPolling,
  };
}
