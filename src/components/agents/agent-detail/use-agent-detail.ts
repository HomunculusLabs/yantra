"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getAgentDetail,
  runAgentPersona,
  saveAgentPersona,
  toggleAgentPersona,
} from "@/lib/api/agents-client";
import type {
  AgentDetailPersona,
  AgentHeartbeatRecord,
  SaveAgentPersonaRequest,
} from "@/types/agent-api";

type RefreshOptions = {
  resetLoading?: boolean;
};

type UseAgentDetailResult = {
  persona: AgentDetailPersona | null;
  history: AgentHeartbeatRecord[];
  loading: boolean;
  running: boolean;
  toggling: boolean;
  refresh: (options?: RefreshOptions) => Promise<void>;
  updatePersona: (patch: SaveAgentPersonaRequest) => Promise<boolean>;
  runAgent: () => Promise<void>;
  toggleAgent: () => Promise<void>;
};

export function useAgentDetail(slug: string): UseAgentDetailResult {
  const [persona, setPersona] = useState<AgentDetailPersona | null>(null);
  const [history, setHistory] = useState<AgentHeartbeatRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [toggling, setToggling] = useState(false);

  const requestRef = useRef(0);
  const runRefreshTimeoutRef = useRef<number | null>(null);

  const clearRunRefreshTimeout = useCallback(() => {
    if (runRefreshTimeoutRef.current !== null) {
      window.clearTimeout(runRefreshTimeoutRef.current);
      runRefreshTimeoutRef.current = null;
    }
  }, []);

  const refresh = useCallback(
    async (options?: RefreshOptions) => {
      const requestId = ++requestRef.current;
      if (options?.resetLoading) {
        setLoading(true);
      }

      try {
        const data = await getAgentDetail(slug);
        if (requestRef.current !== requestId) return;
        setPersona(data.persona);
        setHistory(data.history || []);
      } catch {
        if (requestRef.current !== requestId) return;
      } finally {
        if (requestRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [slug]
  );

  const updatePersona = useCallback(
    async (patch: SaveAgentPersonaRequest) => {
      let success = true;
      try {
        await saveAgentPersona(slug, patch);
      } catch {
        success = false;
      } finally {
        await refresh();
      }
      return success;
    },
    [refresh, slug]
  );

  const runAgent = useCallback(async () => {
    setRunning(true);
    clearRunRefreshTimeout();

    try {
      await runAgentPersona(slug);
    } catch {
      // Preserve the current silent-failure behavior.
    }

    runRefreshTimeoutRef.current = window.setTimeout(() => {
      setRunning(false);
      void refresh();
    }, 2000);
  }, [clearRunRefreshTimeout, refresh, slug]);

  const toggleAgent = useCallback(async () => {
    setToggling(true);
    try {
      await toggleAgentPersona(slug);
    } catch {
      // Preserve the current silent-failure behavior.
    } finally {
      setToggling(false);
      await refresh();
    }
  }, [refresh, slug]);

  useEffect(() => {
    setLoading(true);
    setPersona(null);
    setHistory([]);
    void refresh({ resetLoading: true });
  }, [refresh]);

  useEffect(() => clearRunRefreshTimeout, [clearRunRefreshTimeout]);

  return {
    persona,
    history,
    loading,
    running,
    toggling,
    refresh,
    updatePersona,
    runAgent,
    toggleAgent,
  };
}
