"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          Copy
        </>
      )}
    </button>
  );
}

