"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PluginIframeHostProps {
  src: string;
  title: string;
}

export function PluginIframeHost({ src, title }: PluginIframeHostProps) {
  const [reloadNonce, setReloadNonce] = useState(0);

  const iframeSrc = useMemo(() => {
    const separator = src.includes("?") ? "&" : "?";
    return `${src}${separator}nonce=${reloadNonce}`;
  }, [reloadNonce, src]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="truncate text-[12px] text-muted-foreground">{title}</p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-[12px]"
            onClick={() => setReloadNonce((current) => current + 1)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reload
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-[12px]"
            onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open host
          </Button>
        </div>
      </div>
      <iframe
        key={iframeSrc}
        src={iframeSrc}
        title={title}
        className="min-h-0 flex-1 border-0 bg-background"
        sandbox="allow-scripts"
      />
    </div>
  );
}
