"use client";

import { CloudDownload, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { UpdateCheckResult } from "@/types/system";

interface UpdateSummaryProps {
  update: UpdateCheckResult;
  loading?: boolean;
  refreshing?: boolean;
  backupPending?: boolean;
  backupPath?: string | null;
  actionError?: string | null;
  onRefresh: () => void;
  onCreateBackup: () => Promise<void> | void;
  onOpenDataDir: () => Promise<void> | void;
}

function getStatusLabel(update: UpdateCheckResult): string {
  if (!update.desktopSupported) return "Desktop only";
  if (update.updateStatus.state === "error") return "Check failed";
  if (update.updateAvailable) return "Update available";
  return "Up to date";
}

export function UpdateSummary({
  update,
  loading,
  refreshing,
  backupPending,
  backupPath,
  actionError,
  onRefresh,
  onCreateBackup,
  onOpenDataDir,
}: UpdateSummaryProps) {
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CloudDownload className="h-4 w-4 text-primary" />
            <h3 className="text-[14px] font-semibold text-foreground">
              Yantra updates
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Current {update.current.version}
            {update.latest ? ` • Latest ${update.latest.version}` : ""}
          </p>
        </div>
        <div className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          {loading ? "Checking..." : getStatusLabel(update)}
        </div>
      </div>

      <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
        <div className="rounded-lg border border-border/70 bg-background/60 p-3">
          <p className="font-medium text-foreground">Vault</p>
          <p className="mt-1 break-all font-mono text-[11px]">{update.dataDir}</p>
        </div>
        <div className="rounded-lg border border-border/70 bg-background/60 p-3">
          <p className="font-medium text-foreground">Backups</p>
          <p className="mt-1 break-all font-mono text-[11px]">{update.backupRoot}</p>
        </div>
      </div>

      {update.instructions.length > 0 ? (
        <div className="space-y-2">
          {update.instructions.map((instruction) => (
            <p key={instruction} className="text-xs text-muted-foreground">
              {instruction}
            </p>
          ))}
        </div>
      ) : null}

      {backupPath || actionError ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          {backupPath ? (
            <p className="break-all font-mono text-[11px]">Latest backup: {backupPath}</p>
          ) : null}
          {actionError ? <p className="text-destructive">{actionError}</p> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          onClick={onRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Check now
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          onClick={() => {
            void onOpenDataDir();
          }}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Open vault
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-[12px]"
          onClick={() => {
            void onCreateBackup();
          }}
          disabled={backupPending}
        >
          {backupPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <CloudDownload className="h-3.5 w-3.5" />
          )}
          Create backup
        </Button>
        {update.latestReleaseNotesUrl ? (
          <a
            href={update.latestReleaseNotesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ size: "sm" }) + " h-8 gap-1.5 text-[12px]"}
          >
            Release notes
          </a>
        ) : null}
      </div>
    </div>
  );
}
