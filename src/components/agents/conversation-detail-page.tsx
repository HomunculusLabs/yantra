"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, Bot, ExternalLink, Loader2 } from "lucide-react";
import { ConversationThreadView } from "@/components/ai-panel/conversation-thread-view";
import { buttonVariants } from "@/components/ui/button";
import { CopyButton } from "@/components/agents/conversation-detail/copy-button";
import {
  ContentViewer,
  TranscriptViewer,
} from "@/components/agents/conversation-detail/transcript-viewer";
import { useConversationThread } from "@/components/ai-panel/use-conversation-thread";
import { useAgentCreationDraftStore } from "@/stores/agent-creation-draft-store";
import { useTreeStore } from "@/stores/tree-store";
import type { AgentPersonaDraft } from "@/types/agent-api";
import { patchConversationProposal } from "@/lib/api/agents-client";
import { buildHashRoute } from "@/lib/hash-route";
import { useAppStore } from "@/stores/app-store";

function formatTimestamp(value?: string): string {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function ConversationDetailPage({
  conversationId,
}: {
  conversationId: string;
}) {
  const router = useRouter();
  const { detail, loading, error, setDetail } = useConversationThread(conversationId);
  const seedAgentCreationDraft = useAgentCreationDraftStore(
    (state) => state.seedFromConversation
  );
  const openPath = useTreeStore((state) => state.openPath);
  const setSection = useAppStore((state) => state.setSection);
  const setAgentSettingsReturnSection = useAppStore(
    (state) => state.setAgentSettingsReturnSection
  );
  const currentSection = useAppStore((state) => state.section);
  const [proposalActionPending, setProposalActionPending] = useState<
    "decline" | "restore" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const artifacts = detail?.artifacts ?? [];
  const hasPrompt = Boolean(detail?.prompt?.trim());
  const conversationHash = useMemo(() => {
    if (!detail) return "#/agents";
    return buildHashRoute({ type: "agent", slug: detail.meta.agentSlug }, null);
  }, [detail]);

  function openArtifact(path: string) {
    void openPath(path, { source: "search" });
    setSection({ type: "page" });
    router.push("/");
  }

  function openCreatedAgent(slug: string) {
    router.push(`/${buildHashRoute({ type: "agent", slug }, null)}`);
  }

  function reviewConversationAgentProposal(
    draft: AgentPersonaDraft,
    sourceConversationId: string
  ) {
    seedAgentCreationDraft(draft, sourceConversationId);
    if (currentSection.view !== "settings") {
      setAgentSettingsReturnSection(currentSection);
    }
    router.push(
      `/${buildHashRoute(
        { type: "agents", view: "settings", settingsTarget: "__new__" },
        null
      )}`
    );
  }

  async function handleConversationProposalAction(
    nextConversationId: string,
    action: "decline_agent_proposal" | "restore_agent_proposal"
  ) {
    setProposalActionPending(
      action === "decline_agent_proposal" ? "decline" : "restore"
    );
    setActionError(null);
    try {
      const nextDetail = await patchConversationProposal(nextConversationId, action);
      setDetail(nextDetail);
    } catch (nextError) {
      setActionError(
        nextError instanceof Error
          ? nextError.message
          : "Failed to update conversation proposal"
      );
    } finally {
      setProposalActionPending(null);
    }
  }

  if (!loading && !detail) {
    return (
      <main className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-10">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Yantra
          </Link>
          <div className="rounded-2xl border border-border bg-card p-6">
            <h1 className="text-xl font-semibold">Conversation not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {error || "This conversation no longer exists or failed to load."}
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <Bot className="h-3.5 w-3.5" />
                Conversation transcript
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {detail?.meta.title || "Loading conversation..."}
              </h1>
              <p className="text-sm text-muted-foreground">
                {detail
                  ? `${detail.meta.agentSlug} · ${detail.meta.trigger} · ${detail.meta.status}`
                  : "Loading…"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className={buttonVariants({ variant: "outline" })}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Yantra
              </Link>
              <Link
                href={`/${conversationHash}`}
                className={buttonVariants({ variant: "ghost" })}
              >
                <ExternalLink className="h-4 w-4" />
                Open agent
              </Link>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-border bg-background/60 p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Started
              </p>
              <p className="mt-1 text-sm">{formatTimestamp(detail?.meta.startedAt)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/60 p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Completed
              </p>
              <p className="mt-1 text-sm">{formatTimestamp(detail?.meta.completedAt)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-background/60 p-4">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Transcript file
              </p>
              <p className="mt-1 break-all text-sm text-muted-foreground">
                {detail?.meta.transcriptPath || "Not available"}
              </p>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {error}
          </div>
        ) : null}

        {actionError ? (
          <div className="rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {actionError}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="space-y-6">
            <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold tracking-tight">Prompt</h2>
                  <p className="text-sm text-muted-foreground">
                    The original request that started this run.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {hasPrompt ? <CopyButton text={detail?.prompt || ""} /> : null}
                  {loading && !detail ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : null}
                </div>
              </div>
              <div className="max-h-[24rem] overflow-auto rounded-2xl bg-muted/30 p-4">
                {hasPrompt ? (
                  <ContentViewer text={detail?.prompt || ""} />
                ) : (
                  <p className="text-sm text-muted-foreground">No prompt captured.</p>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
              <h2 className="text-lg font-semibold tracking-tight">Run details</h2>
              <div className="mt-4 space-y-4 text-sm">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Summary
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-foreground">
                    {detail?.meta.summary || "No summary captured."}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Context
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-foreground">
                    {detail?.meta.contextSummary || "No context captured."}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Prompt file
                  </p>
                  <p className="mt-1 break-all text-muted-foreground">
                    {detail?.meta.promptPath || "Not available"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
              <h2 className="text-lg font-semibold tracking-tight">Artifacts</h2>
              <div className="mt-4 space-y-3">
                {artifacts.length > 0 ? (
                  artifacts.map((artifact) => (
                    <button
                      key={artifact.path}
                      onClick={() => openArtifact(artifact.path)}
                      className="block w-full rounded-2xl border border-border bg-muted/20 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                    >
                      <p className="text-xs font-medium text-foreground">
                        {artifact.label || "Artifact"}
                      </p>
                      <p className="mt-1 break-all text-sm text-muted-foreground">
                        {artifact.path}
                      </p>
                    </button>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
                    No artifacts were recorded for this run.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="min-h-[32rem] overflow-hidden rounded-3xl border border-border bg-card/80 shadow-sm">
            <ConversationThreadView
              detail={detail}
              loading={loading && !detail}
              proposalActionPending={proposalActionPending}
              onArtifactClick={openArtifact}
              onAcceptProposal={reviewConversationAgentProposal}
              onDeclineProposal={(id) =>
                handleConversationProposalAction(id, "decline_agent_proposal")
              }
              onRestoreProposal={(id) =>
                handleConversationProposalAction(id, "restore_agent_proposal")
              }
              onOpenCreatedAgent={openCreatedAgent}
            />
          </section>
        </div>

        {detail?.transcript?.trim() ? <TranscriptViewer text={detail.transcript} /> : null}
      </div>
    </main>
  );
}
