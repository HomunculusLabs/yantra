"use client";

import { useEffect, useMemo } from "react";
import { ArrowLeft, AlertTriangle, Loader2, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePluginStore } from "@/stores/plugin-store";
import {
  getPluginCatalogEntryToken,
  type PluginCatalogEntryKey,
} from "@/lib/plugins/plugin-entry-key";
import { PluginIframeHost } from "@/components/plugins/plugin-iframe-host";

interface PluginSurfaceHostProps {
  entryKey: PluginCatalogEntryKey;
  viewId: string;
  onBack: () => void;
}

function statusClasses(status: string) {
  switch (status) {
    case "enabled":
      return "bg-emerald-500/10 text-emerald-400";
    case "needs_review":
      return "bg-amber-500/10 text-amber-300";
    case "error":
      return "bg-red-500/10 text-red-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function PluginSurfaceHost({ entryKey, viewId, onBack }: PluginSurfaceHostProps) {
  const catalogByEntryKey = usePluginStore((state) => state.catalogByEntryKey);
  const catalog = usePluginStore((state) => state.catalog);
  const loading = usePluginStore((state) => state.loading);
  const loadCatalog = usePluginStore((state) => state.loadCatalog);

  useEffect(() => {
    if (!catalogByEntryKey[entryKey] && !loading) {
      void loadCatalog();
    }
  }, [catalogByEntryKey, entryKey, loadCatalog, loading]);

  const plugin = catalogByEntryKey[entryKey] ?? null;
  const view = plugin?.manifest?.views?.find((candidate) => candidate.id === viewId) ?? null;
  const hostSrc = useMemo(
    () => `/plugins/host/${encodeURIComponent(getPluginCatalogEntryToken(entryKey))}/${encodeURIComponent(viewId)}`,
    [entryKey, viewId]
  );

  if (!plugin && loading && catalog.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-[12px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading plugin workspace...
      </div>
    );
  }

  if (!plugin || !plugin.manifest || !view) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <div className="mb-4 flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
        </div>
        <div className="flex flex-1 items-center justify-center rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-[12px] text-red-200">
          <div className="max-w-md space-y-2 text-center">
            <AlertTriangle className="mx-auto h-5 w-5" />
            <p className="font-medium text-red-100">Plugin view unavailable</p>
            <p>
              The selected plugin view could not be resolved from the current catalog. Refresh the plugin catalog or reopen it from Settings.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-[12px]" onClick={onBack}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Button>
            <Puzzle className="h-4 w-4 text-primary" />
            <h2 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-foreground">
              {plugin.manifest.name}
            </h2>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            {view.title} · {plugin.source.kind} · {plugin.manifest.id}
          </p>
        </div>
        <span className={cn("rounded-full px-2 py-1 text-[10px] font-medium", statusClasses(plugin.status))}>
          {plugin.status.replace(/_/g, " ")}
        </span>
      </div>

      <PluginIframeHost src={hostSrc} title={`${plugin.manifest.name} · ${view.title}`} />
    </div>
  );
}
