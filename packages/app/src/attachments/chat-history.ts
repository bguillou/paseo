import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ChatHistoryContextAttachment } from "@/attachments/types";

export type ForkContextPayload = Awaited<ReturnType<DaemonClient["buildAgentForkContext"]>>;

/**
 * Wraps a daemon fork-context payload into a `chat_history` composer attachment.
 * Shared by the turn-footer fork affordance and the new-agent composer's
 * "add conversation" picker. Returns null when the daemon produced no
 * attachment (empty timeline) so callers can surface their own error.
 *
 * `id` controls dedup in the workspace-attachments store: fork keys by draft so
 * a fork replaces the draft's context; the picker keys by source agent so
 * several conversations can coexist and re-picking one replaces it.
 */
export function buildChatHistoryAttachment(input: {
  id: string;
  serverId: string;
  agentId: string;
  payload: ForkContextPayload;
  /** Optional display title (e.g. the source conversation's title) for the pill. */
  title?: string;
}): ChatHistoryContextAttachment | null {
  if (!input.payload.attachment) {
    return null;
  }
  const title = input.title?.trim();
  const attachment = title ? { ...input.payload.attachment, title } : input.payload.attachment;
  return {
    kind: "chat_history",
    id: input.id,
    attachment,
    source: {
      serverId: input.serverId,
      agentId: input.agentId,
      boundaryMessageId: input.payload.boundaryMessageId,
      boundaryCursor: input.payload.boundaryCursor,
      itemCount: input.payload.itemCount,
    },
  };
}
