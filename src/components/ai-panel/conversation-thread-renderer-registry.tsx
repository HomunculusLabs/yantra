"use client";

import type { ReactNode } from "react";
import { Loader2, Sparkles, Wand2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentPersonaDraft } from "@/types/agent-api";
import type {
  ConversationActionThreadItem,
  ConversationAssistantPart,
  ConversationAssistantThreadItem,
  ConversationSystemThreadItem,
  ConversationThreadItem,
  ConversationUserThreadItem,
} from "@/types/conversations";

function StatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
      {label}
    </span>
  );
}

export interface ConversationThreadRenderContext {
  isConversationRunning: boolean;
  proposalActionPending: "decline" | "restore" | null;
  onArtifactClick: (path: string) => void;
  onAcceptProposal: (draft: AgentPersonaDraft, conversationId: string) => void;
  onDeclineProposal: (conversationId: string) => Promise<void>;
  onRestoreProposal: (conversationId: string) => Promise<void>;
  onOpenCreatedAgent: (slug: string) => void;
}

function renderAssistantPart(
  item: ConversationAssistantThreadItem,
  part: ConversationAssistantPart,
  ctx: ConversationThreadRenderContext
): ReactNode {
  const isStreaming = item.state === "streaming";

  if (part.kind === "markdown") {
    return (
      <div
        key={part.id}
        className={cn(
          "mt-3 rounded-2xl px-3 py-2.5",
          isStreaming
            ? "max-h-24 overflow-hidden border border-border/60 bg-background/70"
            : "bg-muted/40"
        )}
      >
        <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground">
          {part.text}
        </p>
      </div>
    );
  }

  if (part.kind === "context") {
    return (
      <div
        key={part.id}
        className="mt-3 rounded-2xl border border-border/70 bg-background/80 p-3 text-[12px] text-muted-foreground"
      >
        {part.text}
      </div>
    );
  }

  if (part.kind === "artifact_list") {
    return (
      <div key={part.id} className="mt-3 flex flex-wrap gap-2">
        {part.artifacts.map((artifact) => (
          <button
            key={artifact.path}
            onClick={() => ctx.onArtifactClick(artifact.path)}
            className="rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            {artifact.label || artifact.path}
          </button>
        ))}
      </div>
    );
  }

  if (part.kind === "status") {
    return (
      <div
        key={part.id}
        className={cn(
          "mt-3 rounded-2xl border px-3 py-2.5 text-[12px]",
          part.tone === "success"
            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-200"
            : part.tone === "warning"
              ? "border-amber-500/20 bg-amber-500/5 text-amber-200"
              : part.tone === "error"
                ? "border-destructive/20 bg-destructive/5 text-destructive"
                : "border-border/70 bg-background/80 text-muted-foreground"
        )}
      >
        <div className="flex items-center gap-2">
          <StatusPill label={part.label} />
        </div>
        {part.detail ? <p className="mt-2">{part.detail}</p> : null}
      </div>
    );
  }

  return (
    <div
      key={part.id}
      className="mt-3 rounded-2xl border border-border/70 bg-background/80 p-3"
    >
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        <Wrench className="h-3.5 w-3.5" />
        {part.toolName}
        <StatusPill label={part.state} />
      </div>
      {part.inputSummary ? (
        <p className="mt-2 text-[12px] text-muted-foreground">
          {part.inputSummary}
        </p>
      ) : null}
      {part.outputSummary ? (
        <p
          className={cn(
            "mt-2 text-[12px]",
            part.isError ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {part.outputSummary}
        </p>
      ) : null}
    </div>
  );
}

function renderUserItem(
  item: ConversationUserThreadItem,
  ctx: ConversationThreadRenderContext
) {
  return (
    <div
      key={item.id}
      className="flex justify-end motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:slide-in-from-right-2 duration-300"
    >
      <div className="max-w-[88%] rounded-[22px] rounded-br-md bg-gradient-to-br from-primary to-primary/85 px-4 py-3 text-[13px] text-primary-foreground shadow-sm shadow-primary/10">
        <div className="mb-2 flex items-center justify-end gap-2">
          <StatusPill label="You" />
        </div>
        <p className="whitespace-pre-wrap leading-relaxed">{item.text}</p>
        {item.pagePath || item.mentionedPaths.length > 0 ? (
          <div className="mt-3 flex flex-wrap justify-end gap-2 text-[11px] text-primary-foreground/85">
            {item.pagePath ? (
              <button
                onClick={() => ctx.onArtifactClick(item.pagePath!)}
                className="rounded-full bg-primary-foreground/10 px-2.5 py-1 hover:bg-primary-foreground/15"
              >
                {item.pagePath}
              </button>
            ) : null}
            {item.mentionedPaths.map((path) => (
              <button
                key={path}
                onClick={() => ctx.onArtifactClick(path)}
                className="rounded-full bg-primary-foreground/10 px-2.5 py-1 hover:bg-primary-foreground/15"
              >
                @{path}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function renderSystemItem(item: ConversationSystemThreadItem) {
  return (
    <div
      key={item.id}
      className="flex justify-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 duration-300"
    >
      <div
        className={cn(
          "max-w-[92%] rounded-2xl border px-4 py-3 text-[12px] shadow-sm",
          item.tone === "success"
            ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-100"
            : item.tone === "warning"
              ? "border-amber-500/20 bg-amber-500/5 text-amber-100"
              : item.tone === "error"
                ? "border-destructive/20 bg-destructive/5 text-destructive"
                : "border-border/70 bg-background/80 text-muted-foreground"
        )}
      >
        <p className="font-medium">{item.title}</p>
        {item.description ? <p className="mt-1">{item.description}</p> : null}
        {item.command ? (
          <code className="mt-2 block overflow-x-auto rounded-xl bg-background/70 px-2.5 py-2 font-mono text-[11px] text-foreground/90">
            {item.command}
          </code>
        ) : null}
      </div>
    </div>
  );
}

function renderAssistantItem(
  item: ConversationAssistantThreadItem,
  ctx: ConversationThreadRenderContext
) {
  const isStreaming = item.state === "streaming";

  return (
    <div
      key={item.id}
      className="flex justify-start motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:slide-in-from-left-2 duration-300"
    >
      <div
        className={cn(
          "max-w-[92%] rounded-[22px] rounded-bl-md border p-4 shadow-sm backdrop-blur-sm transition-all duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1",
          isStreaming
            ? "border-primary/20 bg-primary/5 shadow-primary/5"
            : "border-border/80 bg-card/95"
        )}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            AI
          </div>
          <div className="flex items-center gap-2">
            {isStreaming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : null}
            <StatusPill
              label={
                item.state === "streaming"
                  ? "Working"
                  : item.state === "completed"
                    ? "Done"
                    : item.state === "cancelled"
                      ? "Cancelled"
                      : "Failed"
              }
            />
          </div>
        </div>

        {item.summary ? (
          <p className="mt-3 text-[13px] leading-relaxed text-foreground">
            {item.summary}
          </p>
        ) : null}

        {item.parts.map((part) => renderAssistantPart(item, part, ctx))}
      </div>
    </div>
  );
}

function renderAgentProposalAction(
  item: ConversationActionThreadItem,
  ctx: ConversationThreadRenderContext
) {
  const proposal = item.proposal;
  const draft = proposal.draft;
  const title =
    proposal.status === "parse_error"
      ? "Agent draft unavailable"
      : draft?.name || "Agent draft";
  const subtitle =
    proposal.status === "parse_error"
      ? "Couldn’t parse the proposed agent draft."
      : `${draft?.slug || "missing-slug"}${draft?.role ? ` · ${draft.role}` : ""}`;

  return (
    <div
      key={item.id}
      className="flex justify-start motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 duration-300"
    >
      <div className="max-w-[92%] rounded-[24px] rounded-bl-md border border-primary/20 bg-gradient-to-br from-primary/8 via-background to-background p-4 shadow-sm transition-all duration-200 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-primary/80">
              <Sparkles className="h-3.5 w-3.5" />
              Suggested action
            </div>
            <p className="mt-2 text-[14px] font-semibold text-foreground">
              {title}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {subtitle}
            </p>
          </div>
          <StatusPill label={proposal.status.replace(/_/g, " ")} />
        </div>

        {draft?.heartbeat || draft?.launcher?.launcherId ? (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {draft?.heartbeat ? (
              <span className="rounded-full border border-border/70 bg-background px-2.5 py-1">
                {draft.heartbeat}
              </span>
            ) : null}
            {draft?.launcher?.launcherId ? (
              <span className="rounded-full border border-border/70 bg-background px-2.5 py-1">
                {draft.launcher.launcherId}
                {draft.launcher.model ? ` · ${draft.launcher.model}` : ""}
              </span>
            ) : null}
          </div>
        ) : null}

        {proposal.issues.length > 0 ? (
          <div className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-[12px] text-amber-100">
            <p className="font-medium text-amber-200">Proposal issues</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {proposal.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {proposal.status === "pending" && draft ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-8 gap-1 rounded-full px-4 text-xs"
              onClick={() =>
                ctx.onAcceptProposal(draft, item.sourceConversationId)
              }
            >
              <Wand2 className="h-3.5 w-3.5" />
              Accept…
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-4 text-xs"
              disabled={ctx.proposalActionPending === "decline"}
              onClick={() => void ctx.onDeclineProposal(item.sourceConversationId)}
            >
              {ctx.proposalActionPending === "decline"
                ? "Declining…"
                : "Decline"}
            </Button>
          </div>
        ) : proposal.status === "applied" && proposal.createdAgentSlug ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-4 text-xs"
              onClick={() => ctx.onOpenCreatedAgent(proposal.createdAgentSlug!)}
            >
              Open settings
            </Button>
          </div>
        ) : proposal.status === "declined" ? (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 rounded-full px-4 text-xs"
              disabled={ctx.proposalActionPending === "restore"}
              onClick={() => void ctx.onRestoreProposal(item.sourceConversationId)}
            >
              {ctx.proposalActionPending === "restore"
                ? "Restoring…"
                : "Restore"}
            </Button>
          </div>
        ) : null}

        {proposal.status === "pending" ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Accept opens review; nothing is created until you save.
          </p>
        ) : proposal.status === "applied" && proposal.createdAgentSlug ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Created as {proposal.createdAgentSlug}.
          </p>
        ) : proposal.status === "declined" ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            This suggestion was declined and can be restored later.
          </p>
        ) : proposal.status === "parse_error" ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Re-run the request or tighten the prompt before trying to create the
            agent.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function renderConversationThreadItem(
  item: ConversationThreadItem,
  ctx: ConversationThreadRenderContext
): ReactNode {
  if (item.kind === "user") {
    return renderUserItem(item, ctx);
  }

  if (item.kind === "system") {
    return renderSystemItem(item);
  }

  if (item.kind === "assistant") {
    return renderAssistantItem(item, ctx);
  }

  if (item.actionType === "agent_proposal") {
    return renderAgentProposalAction(item, ctx);
  }

  return null;
}
