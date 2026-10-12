import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { prPaneTimelineQueryKey } from "./query-keys";

/**
 * Forge-neutral resolve target. GitHub and GitLab resolve a review thread /
 * discussion by its opaque `threadId` from the timeline.
 */
export interface PrResolveTarget {
  prNumber: number;
  threadId: string;
  resolved: boolean;
  repoOwner?: string;
  repoName?: string;
}

export interface PrResolveResult {
  ok: boolean;
  error: string | null;
}

export interface UseResolvePrThreadResult {
  /** True when the daemon advertises the resolve capability. Gate the UI on this. */
  enabled: boolean;
  /** Resolves/reopens a thread and refetches the timeline on success. Never rejects. */
  setResolved: (target: PrResolveTarget) => Promise<PrResolveResult>;
}

export function useResolvePrThread({
  serverId,
  cwd,
}: {
  serverId: string;
  cwd: string;
}): UseResolvePrThreadResult {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const enabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutForgeResolveThread === true,
  );

  const setResolved = useCallback(
    async (target: PrResolveTarget): Promise<PrResolveResult> => {
      if (!client || !enabled || target.threadId.length === 0) {
        return { ok: false, error: t("workspace.git.pr.errors.resolveFailed") };
      }
      try {
        const payload = await client.checkoutForgeResolveThread(cwd, {
          prNumber: target.prNumber,
          threadId: target.threadId,
          resolved: target.resolved,
          ...(target.repoOwner ? { repoOwner: target.repoOwner } : {}),
          ...(target.repoName ? { repoName: target.repoName } : {}),
        });
        if (payload.error) {
          return {
            ok: false,
            error: payload.error.message || t("workspace.git.pr.errors.resolveFailed"),
          };
        }
        // Refetch the timeline so the resolved state updates in the list and inline.
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
              : t("workspace.git.pr.errors.resolveFailed"),
        };
      }
    },
    [client, cwd, enabled, queryClient, serverId, t],
  );

  return useMemo(() => ({ enabled, setResolved }), [enabled, setResolved]);
}
