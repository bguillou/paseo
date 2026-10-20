import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  AssistantForkMenu,
  type AssistantForkMenuLabels,
  type AssistantForkTarget,
} from "@/components/assistant-fork-menu";
import { useStartFromPlan } from "@/hooks/use-start-from-plan";

interface PlanStartMenuProps {
  serverId: string;
  workspaceId?: string;
  workspaceRoot: string;
  planPath: string;
}

export function PlanStartMenu({
  serverId,
  workspaceId,
  workspaceRoot,
  planPath,
}: PlanStartMenuProps) {
  const { t } = useTranslation();
  const startFromPlan = useStartFromPlan({ serverId, workspaceId, workspaceRoot });
  const labels = useMemo<AssistantForkMenuLabels>(
    () => ({
      trigger: t("message.actions.planMenu"),
      tab: t("message.actions.planInNewTab"),
      workspace: t("message.actions.planInNewWorkspace"),
    }),
    [t],
  );
  const handleStart = useCallback(
    (target: AssistantForkTarget) => startFromPlan({ planPath, target }),
    [planPath, startFromPlan],
  );
  return <AssistantForkMenu onFork={handleStart} labels={labels} testID="plan-start-menu" />;
}
