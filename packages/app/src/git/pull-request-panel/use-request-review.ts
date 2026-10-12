import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { checkoutPrStatusQueryKey } from "@/git/query-keys";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

/** Forge-neutral re-request target. The reviewer is already on the PR. */
export interface PrRequestReviewTarget {
  prNumber: number;
  reviewerLogin: string;
  repoOwner?: string;
  repoName?: string;
}

export interface PrRequestReviewResult {
  ok: boolean;
  error: string | null;
}

export interface UseRequestReviewResult {
  /** True when the daemon advertises the request-review capability. Gate the UI on this. */
  enabled: boolean;
  /** Re-requests a review and refetches the PR status on success. Never rejects. */
  requestReview: (target: PrRequestReviewTarget) => Promise<PrRequestReviewResult>;
}

export function useRequestReview({
  serverId,
  cwd,
}: {
  serverId: string;
  cwd: string;
}): UseRequestReviewResult {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const enabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutForgeRequestReview === true,
  );

  const requestReview = useCallback(
    async (target: PrRequestReviewTarget): Promise<PrRequestReviewResult> => {
      if (!client || !enabled || target.reviewerLogin.length === 0) {
        return { ok: false, error: t("workspace.git.pr.errors.requestReviewFailed") };
      }
      try {
        const payload = await client.checkoutForgeRequestReview(cwd, {
          prNumber: target.prNumber,
          reviewerLogin: target.reviewerLogin,
          ...(target.repoOwner ? { repoOwner: target.repoOwner } : {}),
          ...(target.repoName ? { repoName: target.repoName } : {}),
        });
        if (payload.error) {
          return {
            ok: false,
            error: payload.error.message || t("workspace.git.pr.errors.requestReviewFailed"),
          };
        }
        // Refetch the status so the reviewer flips to "awaiting" without a manual reload.
        await queryClient.invalidateQueries({
          queryKey: checkoutPrStatusQueryKey(serverId, cwd),
        });
        return { ok: true, error: null };
      } catch (requestError) {
        return {
          ok: false,
          error:
            requestError instanceof Error
              ? requestError.message
              : t("workspace.git.pr.errors.requestReviewFailed"),
        };
      }
    },
    [client, cwd, enabled, queryClient, serverId, t],
  );

  return useMemo(() => ({ enabled, requestReview }), [enabled, requestReview]);
}
