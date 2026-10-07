import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { prPaneTimelineQueryKey } from "./query-keys";

/**
 * Forge-neutral reply target. Mirrors the daemon's reply options: the caller
 * passes every identity the timeline exposed and each adapter uses what it needs.
 */
export interface PrReplyTarget {
  prNumber: number;
  repoOwner?: string;
  repoName?: string;
  threadId?: string;
  isGeneralDiscussion?: boolean;
  location?: { path: string; line?: number };
}

export interface PrReplyResult {
  ok: boolean;
  error: string | null;
}

export interface UseReplyToPrCommentResult {
  /** True when the daemon advertises the reply capability. Gate the UI on this. */
  enabled: boolean;
  /** Posts a reply and refetches the timeline on success. Never rejects. */
  reply: (input: { target: PrReplyTarget; body: string }) => Promise<PrReplyResult>;
}

export function useReplyToPrComment({
  serverId,
  cwd,
}: {
  serverId: string;
  cwd: string;
}): UseReplyToPrCommentResult {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const enabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutForgeReplyComment === true,
  );

  const reply = useCallback(
    async ({ target, body }: { target: PrReplyTarget; body: string }): Promise<PrReplyResult> => {
      const trimmed = body.trim();
      if (!client || !enabled || trimmed.length === 0) {
        return { ok: false, error: t("workspace.git.pr.errors.replyFailed") };
      }
      try {
        const payload = await client.checkoutForgeReplyComment(cwd, {
          prNumber: target.prNumber,
          body: trimmed,
          ...(target.repoOwner ? { repoOwner: target.repoOwner } : {}),
          ...(target.repoName ? { repoName: target.repoName } : {}),
          ...(target.threadId ? { threadId: target.threadId } : {}),
          ...(target.isGeneralDiscussion
            ? { isGeneralDiscussion: target.isGeneralDiscussion }
            : {}),
          ...(target.location ? { location: target.location } : {}),
        });
        if (payload.error) {
          return {
            ok: false,
            error: payload.error.message || t("workspace.git.pr.errors.replyFailed"),
          };
        }
        // Refetch the timeline so the posted reply shows up in the list and inline.
        await queryClient.invalidateQueries({
          queryKey: prPaneTimelineQueryKey({ serverId, cwd, prNumber: target.prNumber }),
        });
        return { ok: true, error: null };
      } catch (requestError) {
        return {
          ok: false,
          error:
            requestError instanceof Error
              ? requestError.message
              : t("workspace.git.pr.errors.replyFailed"),
        };
      }
    },
    [client, cwd, enabled, queryClient, serverId, t],
  );

  return useMemo(() => ({ enabled, reply }), [enabled, reply]);
}
