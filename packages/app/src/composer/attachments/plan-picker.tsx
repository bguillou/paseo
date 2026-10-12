import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type RefObject,
} from "react";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { AgentPlanEntry, DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { PlanModeIcon } from "@/agent-controls/icons";
import { buildPlanContextAttachment } from "@/attachments/plan";
import { useWorkspaceAttachmentsStore } from "@/attachments/workspace-attachments-store";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import type { AttachmentMenuItem } from "@/composer/input/input";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";
import { formatCompactTimeAgo } from "@/utils/time";

const iconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedPlanIcon = withUnistyles(PlanModeIcon);

function planOptionId(entry: AgentPlanEntry): string {
  return `${entry.agentId}:${entry.planKey}`;
}

interface PlanAttachmentPickerInput {
  serverId: string;
  cwd: string;
  /** Worktree scope: prefer the resolved workspace, fall back to cwd. */
  workspaceId?: string | null;
  /** The composer's own agent id, whose plans are dropped from the list. */
  excludeAgentId?: string;
  /** Scope key to write the plan_context attachment into. */
  scopeKey: string | undefined;
  client: DaemonClient | null;
  anchorRef: RefObject<View | null>;
  enabled: boolean;
}

interface PlanAttachmentPickerBinding {
  menuItems: AttachmentMenuItem[];
  picker: ReactElement | null;
}

export function usePlanAttachmentPicker(
  input: PlanAttachmentPickerInput,
): PlanAttachmentPickerBinding {
  const { t } = useTranslation();
  const toast = useToast();
  const supportsPlanContext = useHostFeature(input.serverId, "agentPlanContext");
  const enabled = input.enabled && supportsPlanContext && Boolean(input.scopeKey);
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<readonly AgentPlanEntry[]>([]);

  const { client, workspaceId, cwd, excludeAgentId } = input;

  const refresh = useCallback(async () => {
    if (!client) {
      return;
    }
    try {
      const fetched = await client.listAgentPlans({
        ...(workspaceId ? { workspaceId } : {}),
        cwd,
      });
      setPlans(fetched.filter((entry) => entry.agentId !== excludeAgentId));
    } catch (error) {
      toast.error(toErrorMessage(error) || t("composer.attachments.attachPlanFailed"));
    }
  }, [client, cwd, excludeAgentId, t, toast, workspaceId]);

  // Load once when the affordance becomes usable so the menu item can hide when
  // the worktree has no plans, then refresh each time the picker opens.
  useEffect(() => {
    if (!enabled) {
      setPlans([]);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  const options = useMemo<ComboboxOption[]>(
    () =>
      plans.map((entry) => {
        const title = entry.agentTitle?.trim();
        const timeAgo = formatCompactTimeAgo(new Date(entry.createdAt));
        return {
          id: planOptionId(entry),
          label: entry.summary?.trim() || title || t("composer.attachments.planUntitled"),
          description: title ? `${title} · ${timeAgo}` : timeAgo,
        };
      }),
    [plans, t],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) {
        void refresh();
      }
    },
    [refresh],
  );

  const handleSelect = useCallback(
    (optionId: string) => {
      const { scopeKey, serverId } = input;
      setOpen(false);
      if (!scopeKey) {
        return;
      }
      const entry = plans.find((candidate) => planOptionId(candidate) === optionId);
      if (!entry) {
        return;
      }
      const attachment = buildPlanContextAttachment({ serverId, entry });
      useWorkspaceAttachmentsStore.getState().addWorkspaceAttachment({ scopeKey, attachment });
    },
    [input, plans],
  );

  const menuItems = useMemo<AttachmentMenuItem[]>(() => {
    if (!enabled || plans.length === 0) {
      return [];
    }
    return [
      {
        id: "plan",
        label: t("composer.attachments.addPlan"),
        icon: <ThemedPlanIcon size={ICON_SIZE.md} uniProps={iconColorMapping} />,
        onSelect: () => setOpen(true),
      },
    ];
  }, [enabled, plans.length, t]);

  if (!open || !enabled) {
    return { menuItems, picker: null };
  }

  return {
    menuItems,
    picker: (
      <Combobox
        options={options}
        value=""
        onSelect={handleSelect}
        searchable
        searchPlaceholder={t("composer.attachments.planSearchPlaceholder")}
        title={t("composer.attachments.planPickerTitle")}
        open
        onOpenChange={handleOpenChange}
        desktopPlacement="top-start"
        anchorRef={input.anchorRef}
        emptyText={t("composer.attachments.planEmpty")}
      />
    ),
  };
}
