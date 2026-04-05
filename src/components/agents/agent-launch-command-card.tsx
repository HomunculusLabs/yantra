"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { getAgentLaunchPreview } from "@/lib/api/agents-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { AgentLaunchPreviewResponse } from "@/types/agent-api";

export function AgentLaunchCommandCard({
  slug,
  title = "Launch command",
  description = "This is the command Yantra currently uses to start this agent.",
  className,
  showSource = true,
}: {
  slug: string;
  title?: string;
  description?: string;
  className?: string;
  showSource?: boolean;
}) {
  const [preview, setPreview] = useState<AgentLaunchPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    void getAgentLaunchPreview(slug)
      .then((data) => {
        if (cancelled) return;
        setPreview(data);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setPreview(null);
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to load launch command"
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (!preview?.commandLine) return;
    try {
      await navigator.clipboard.writeText(preview.commandLine);
      setCopied(true);
      if (copyTimeoutRef.current !== null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard failures
    }
  };

  return (
    <div className={cn("space-y-3 rounded-xl border border-border p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-foreground">{title}</p>
          <p className="text-[11px] text-muted-foreground">{description}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-xs"
          onClick={() => void handleCopy()}
          disabled={!preview?.commandLine}
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </>
          )}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading launch command...
        </div>
      ) : error ? (
        <p className="text-[11px] text-red-400">{error}</p>
      ) : preview ? (
        <>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <code className="block whitespace-pre-wrap break-words text-[12px] text-foreground">
              {preview.commandLine}
            </code>
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            <span className="rounded-full border border-border px-2 py-0.5">
              launcher: {preview.launcherId}
            </span>
            {showSource ? (
              <span className="rounded-full border border-border px-2 py-0.5">
                source: {preview.source}
              </span>
            ) : null}
            <span className="rounded-full border border-border px-2 py-0.5">
              transport: {preview.transport}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5">
              prompt: {preview.promptMethod}
            </span>
            {preview.usesDirectCommand ? (
              <span className="rounded-full border border-border px-2 py-0.5">
                direct override
              </span>
            ) : null}
          </div>
          <p className="font-mono text-[10px] text-muted-foreground/80">
            cwd: {preview.cwd}
          </p>
          {preview.promptMethod === "argv" ? (
            <p className="text-[10px] text-muted-foreground/70">
              <code>&lt;prompt&gt;</code> is a placeholder for runtime prompt injection.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
