import { ConversationDetailPage } from "@/components/agents/conversation-detail-page";

export const dynamic = "force-dynamic";

export default async function AgentsConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ConversationDetailPage conversationId={id} />;
}
