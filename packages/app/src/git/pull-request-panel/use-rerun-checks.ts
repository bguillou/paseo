import { useCallback, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { checkoutPrStatusQueryKey } from "@/git/query-keys";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

/**
 * Forge-neutral re-run target:
 *  - { mode: "run" }    re-run every job in the workflow run
 *  - { mode: "failed" } re-run only the failed jobs in the workflow run
 *  - { mode: "check" }  re-run a single check run
 */
export type PrRerunChecksTarget =
  | { mode: "run"; workflowRunId: number }
  | { mode: "failed"; workflowRunId: number }
  | { mode: "check"; checkRunId: number };

export interface PrRerunChecksInput {
  prNumber: number;
  target: PrRerunChecksTarget;
  repoOwner?: string;
  repoName?: string;
}

export interface PrRerunChecksResult {
  ok: boolean;
  error: string | null;
}

export interface UseRerunChecksResult {
  /** True when the daemon advertises the re-run capability. Gate the UI on this. */
  enabled: boolean;
  /** Re-runs CI and refetches the PR status on success. Never rejects. */
  rerunChecks: (input: PrRerunChecksInput) => Promise<PrRerunChecksResult>;
}

export function useRerunChecks({
  serverId,
  cwd,
}: {
  serverId: string;
  cwd: string;
}): UseRerunChecksResult {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const queryClient = useQueryClient();
  const enabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutForgeRerunChecks === true,
  );

  const rerunChecks = useCallback(
    async (input: PrRerunChecksInput): Promise<PrRerunChecksResult> => {
      if (!client || !enabled) {
        return { ok: false, error: t("workspace.git.pr.errors.rerunChecksFailed") };
      }
      try {
        const payload = await client.checkoutForgeRerunChecks(cwd, {
          prNumber: input.prNumber,
          target: input.target,
          ...(input.repoOwner ? { repoOwner: input.repoOwner } : {}),
          ...(input.repoName ? { repoName: input.repoName } : {}),
        });
        if (payload.error) {
          return {
            ok: false,
            error: payload.error.message || t("workspace.git.pr.errors.rerunChecksFailed"),
          };
        }
        // Refetch so the re-queued checks flip to pending without a manual reload.
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
              : t("workspace.git.pr.errors.rerunChecksFailed"),
        };
      }
    },
    [client, cwd, enabled, queryClient, serverId, t],
  );

  return useMemo(() => ({ enabled, rerunChecks }), [enabled, rerunChecks]);
}
