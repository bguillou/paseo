import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { createWorkspaceFileAttachment } from "@/attachments/workspace-file";
import type { AssistantForkTarget } from "@/components/assistant-fork-menu";
import { useToast } from "@/contexts/toast-api-context";
import { useStableEvent } from "@/hooks/use-stable-event";
import {
  buildDraftStoreKey,
  buildNewWorkspaceDraftKey,
  generateDraftId,
} from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { toErrorMessage } from "@/utils/error-messages";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import { resolveWorkspaceFilePaths } from "@/workspace/file-open";

const PLAN_FILE_PATTERN = /(^|\/)plans\/.+\.md$/i;

/** Markdown files under a `plans/` directory (e.g. `~/.claude/plans/`, `<repo>/.claude/plans/`). */
export function isPlanFilePath(path: string): boolean {
  return PLAN_FILE_PATTERN.test(path.trim().replace(/\\/g, "/"));
}

export interface StartFromPlanRequest {
  planPath: string;
  target: AssistantForkTarget;
}

export interface UseStartFromPlanInput {
  serverId: string;
  workspaceId?: string;
  workspaceRoot: string;
}

/**
 * Opens a blank chat draft — in a new tab or a new workspace — with the plan file
 * attached. The path is made absolute so it still resolves from a new worktree.
 */
export function useStartFromPlan(
  input: UseStartFromPlanInput,
): (request: StartFromPlanRequest) => Promise<void> {
  const { serverId, workspaceId, workspaceRoot } = input;
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();

  return useStableEvent(async ({ planPath, target }) => {
    try {
      const absolutePath =
        resolveWorkspaceFilePaths({ path: planPath, workspaceRoot })?.absolutePath ?? planPath;
      const attachment = createWorkspaceFileAttachment({ path: absolutePath });
      const draftId = generateDraftId();

      if (target === "tab") {
        if (!workspaceId) {
          throw new Error(t("message.actions.forkMissingWorkspace"));
        }
        await useDraftStore.getState().attachWorkspaceFile({
          draftKey: buildDraftStoreKey({ serverId, agentId: draftId, draftId }),
          attachment,
        });
        navigateToWorkspace({ serverId, workspaceId, target: { kind: "draft", draftId } });
        return;
      }

      await useDraftStore.getState().attachWorkspaceFile({
        draftKey: buildNewWorkspaceDraftKey(draftId),
        attachment,
      });
      router.push(
        buildNewWorkspaceRoute({
          serverId,
          sourceDirectory: workspaceRoot.trim() || undefined,
          draftId,
        }),
      );
    } catch (error) {
      toast.error(toErrorMessage(error) || t("message.actions.planFailed"));
    }
  });
}
