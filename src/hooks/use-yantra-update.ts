"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UpdateCheckResult } from "@/types/system";

export function useYantraUpdate() {
  const [update, setUpdate] = useState<UpdateCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [backupPending, setBackupPending] = useState(false);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/system/update", {
        cache: "no-store",
      });
      const data = (await response.json()) as UpdateCheckResult & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Update check failed (${response.status})`);
      }
      setUpdate(data);
      setActionError(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to fetch update status"
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const createBackup = useCallback(async () => {
    setBackupPending(true);
    try {
      const response = await fetch("/api/system/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "data" }),
      });
      const data = (await response.json()) as { backupPath?: string; error?: string };
      if (!response.ok || !data.backupPath) {
        throw new Error(data.error || `Backup failed (${response.status})`);
      }
      setBackupPath(data.backupPath);
      setActionError(null);
      return data.backupPath;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backup failed";
      setActionError(message);
      throw error;
    } finally {
      setBackupPending(false);
    }
  }, []);

  const openDataDir = useCallback(async () => {
    try {
      if (window.yantraDesktop?.openDataDirectory) {
        await window.yantraDesktop.openDataDirectory();
        setActionError(null);
        return;
      }

      const response = await fetch("/api/system/open-data-dir", { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || `Failed to open data folder (${response.status})`);
      }
      setActionError(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to open data folder";
      setActionError(message);
      throw error;
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return useMemo(
    () => ({
      update,
      loading,
      refreshing,
      backupPending,
      backupPath,
      actionError,
      refresh,
      createBackup,
      openDataDir,
    }),
    [
      update,
      loading,
      refreshing,
      backupPending,
      backupPath,
      actionError,
      refresh,
      createBackup,
      openDataDir,
    ]
  );
}
