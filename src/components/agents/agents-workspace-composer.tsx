"use client";

import { useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  makePageContextLabel,
  type WorkspacePageOption,
} from "@/components/agents/agents-workspace.helpers";

interface AgentsWorkspaceComposerProps {
  agentName: string;
  allPages: WorkspacePageOption[];
  value: string;
  mentionedPaths: string[];
  submitting: boolean;
  onValueChange: (value: string) => void;
  onMentionedPathsChange: (paths: string[]) => void;
  onSubmit: () => void | Promise<void>;
}

export function AgentsWorkspaceComposer({
  agentName,
  allPages,
  value,
  mentionedPaths,
  submitting,
  onValueChange,
  onMentionedPathsChange,
  onSubmit,
}: AgentsWorkspaceComposerProps) {
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionStartPos, setMentionStartPos] = useState(0);

  const filteredMentions = useMemo(
    () =>
      allPages.filter(
        (page) =>
          page.title.toLowerCase().includes(mentionQuery.toLowerCase()) ||
          page.path.toLowerCase().includes(mentionQuery.toLowerCase())
      ),
    [allPages, mentionQuery]
  );

  function handleInput(nextValue: string, cursorPosition: number) {
    onValueChange(nextValue);

    const textBefore = nextValue.slice(0, cursorPosition);
    const atIndex = textBefore.lastIndexOf("@");

    if (atIndex === -1) {
      setShowMentions(false);
      return;
    }

    const charBefore = atIndex > 0 ? textBefore[atIndex - 1] : " ";
    if (charBefore !== " " && charBefore !== "\n" && atIndex !== 0) {
      setShowMentions(false);
      return;
    }

    const query = textBefore.slice(atIndex + 1);
    if (query.includes(" ") || query.includes("\n")) {
      setShowMentions(false);
      return;
    }

    setMentionStartPos(atIndex);
    setMentionQuery(query);
    setMentionIndex(0);
    setShowMentions(true);
  }

  function insertMention(path: string, title: string) {
    const before = value.slice(0, mentionStartPos);
    const after = value.slice(mentionStartPos + mentionQuery.length + 1);
    onValueChange(`${before}@${title} ${after}`);
    onMentionedPathsChange(
      mentionedPaths.includes(path) ? mentionedPaths : [...mentionedPaths, path]
    );
    setShowMentions(false);
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="relative rounded-2xl border border-border bg-card p-4 shadow-sm">
        <textarea
          value={value}
          onChange={(event) =>
            handleInput(
              event.target.value,
              event.target.selectionStart || event.target.value.length
            )
          }
          onKeyDown={(event) => {
            if (showMentions && filteredMentions.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMentionIndex((current) => (current + 1) % filteredMentions.length);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setMentionIndex((current) =>
                  current === 0 ? filteredMentions.length - 1 : current - 1
                );
              } else if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const page = filteredMentions[mentionIndex];
                if (page) insertMention(page.path, page.title);
              } else if (event.key === "Escape") {
                setShowMentions(false);
              }
              return;
            }

            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void onSubmit();
            }
          }}
          placeholder={`Ask ${agentName} to work on something...`}
          className="min-h-[180px] w-full resize-none bg-transparent text-[14px] outline-none"
        />

        {mentionedPaths.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {mentionedPaths.map((path) => (
              <button
                key={path}
                onClick={() =>
                  onMentionedPathsChange(
                    mentionedPaths.filter((entry) => entry !== path)
                  )
                }
                className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                @{makePageContextLabel(path, allPages)}
              </button>
            ))}
          </div>
        ) : null}

        {showMentions && filteredMentions.length > 0 ? (
          <div className="absolute left-4 right-4 top-[calc(100%-12px)] z-10 rounded-xl border border-border bg-popover p-1 shadow-lg">
            {filteredMentions.slice(0, 6).map((page, index) => (
              <button
                key={page.path}
                onClick={() => insertMention(page.path, page.title)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12px]",
                  index === mentionIndex
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <span className="truncate">{page.title}</span>
                <span className="ml-3 truncate text-[11px] text-muted-foreground">
                  {page.path}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground">
            Tip: type <span className="font-mono">@</span> to mention KB files. Press
            Cmd/Ctrl + Enter to send.
          </p>
          <Button className="gap-2" onClick={() => void onSubmit()} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Start conversation
          </Button>
        </div>
      </div>
    </div>
  );
}
