import { useCallback, useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { ToastApi } from "@/components/toast-host";
import { useFetchQuery } from "@/data/query";
import { invalidateCheckoutGitQueriesForClient } from "@/git/query-keys";
import { createBaseBranchSwitcherOperations } from "@/git/base-branch-switcher-operations";

interface UseBaseBranchSwitcherInput {
  client: DaemonClient | null;
  normalizedServerId: string;
  normalizedWorkspaceId: string;
  workspaceDirectory: string | null;
  baseBranchName: string | null;
  isGitCheckout: boolean;
  isConnected: boolean;
  toast: ToastApi;
  queryClient: QueryClient;
}

interface UseBaseBranchSwitcherResult {
  branchOptions: ComboboxOption[];
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  handleBaseSelect: (branchName: string) => void;
}

export function useBaseBranchSwitcher({
  client,
  normalizedServerId,
  normalizedWorkspaceId,
  workspaceDirectory,
  baseBranchName,
  isGitCheckout,
  isConnected,
  toast,
  queryClient,
}: UseBaseBranchSwitcherInput): UseBaseBranchSwitcherResult {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  // Git operations are bound to the workspace directory; the opaque workspace id is used only
  // for query cache identity below, never as a cwd.
  const operations = useMemo(
    () =>
      client && workspaceDirectory
        ? createBaseBranchSwitcherOperations(client, workspaceDirectory)
        : null,
    [client, workspaceDirectory],
  );

  const branchSuggestionsQuery = useFetchQuery({
    queryKey: ["baseBranchSuggestions", normalizedServerId, normalizedWorkspaceId],
    queryFn: async () => {
      if (!operations) {
        throw new Error(t("common.errors.daemonClientUnavailable"));
      }
      const payload = await operations.getBranchSuggestions(200);
      if (payload.error) {
        throw new Error(payload.error);
      }
      return payload.branches ?? [];
    },
    enabled: isOpen && isGitCheckout && Boolean(operations) && isConnected,
    retry: false,
    dataShape: "list",
    staleTimeMs: 15_000,
  });

  const branchOptions = useMemo<ComboboxOption[]>(() => {
    const branches = branchSuggestionsQuery.data ?? [];
    return branches.map((name) => ({ id: name, label: name }));
  }, [branchSuggestionsQuery.data]);

  const handleBaseSelect = useCallback(
    (branchName: string) => {
      if (branchName === baseBranchName) return;

      void (async () => {
        if (!operations || !workspaceDirectory) return;
        try {
          const payload = await operations.setBaseRef(branchName);
          if (payload.error) {
            toast.error(payload.error.message);
            return;
          }
          await invalidateCheckoutGitQueriesForClient(queryClient, {
            serverId: normalizedServerId,
            cwd: workspaceDirectory,
          });
          toast.show(t("baseBranchSwitcher.baseChanged", { branchName }));
        } catch (err) {
          toast.error(err instanceof Error ? err.message : t("baseBranchSwitcher.failedToChange"));
        }
      })();
    },
    [operations, baseBranchName, workspaceDirectory, normalizedServerId, queryClient, toast, t],
  );

  return { branchOptions, isOpen, setIsOpen, handleBaseSelect };
}
