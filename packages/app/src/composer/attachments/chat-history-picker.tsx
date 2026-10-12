import { useCallback, useMemo, useState, type ReactElement, type RefObject } from "react";
import { View } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { History } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { buildChatHistoryAttachment } from "@/attachments/chat-history";
import { useWorkspaceAttachmentsStore } from "@/attachments/workspace-attachments-store";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { selectChatHistoryCandidateAgents } from "@/composer/attachments/chat-history-candidates";
import type { AttachmentMenuItem } from "@/composer/input/input";
import { useToast } from "@/contexts/toast-context";
import { useAggregatedAgents } from "@/hooks/use-aggregated-agents";
import { useHostFeature } from "@/runtime/host-features";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { toErrorMessage } from "@/utils/error-messages";
import { formatCompactTimeAgo } from "@/utils/time";

const iconColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedHistoryIcon = withUnistyles(History);

interface ChatHistoryAttachmentPickerInput {
  serverId: string;
  cwd: string;
  /** The draft's placeholder agent id, excluded from the candidate list. */
  excludeAgentId?: string;
  /** Draft attachment scope key to write the chat_history attachment into. */
  scopeKey: string | undefined;
  client: DaemonClient | null;
  anchorRef: RefObject<View | null>;
  /** Only new-agent (draft) composers enable this affordance. */
  enabled: boolean;
}

interface ChatHistoryAttachmentPickerBinding {
  menuItems: AttachmentMenuItem[];
  picker: ReactElement | null;
}

export function useChatHistoryAttachmentPicker(
  input: ChatHistoryAttachmentPickerInput,
): ChatHistoryAttachmentPickerBinding {
  const { t } = useTranslation();
  const toast = useToast();
  const supportsForkContext = useHostFeature(input.serverId, "agentForkContext");
  const enabled = input.enabled && supportsForkContext && Boolean(input.scopeKey);
  const [open, setOpen] = useState(false);
  const { agents } = useAggregatedAgents({ includeArchived: true, demand: enabled });

  const candidates = useMemo(
    () =>
      enabled
        ? selectChatHistoryCandidateAgents({
            agents,
            serverId: input.serverId,
            cwd: input.cwd,
            excludeAgentId: input.excludeAgentId,
          })
        : [],
    [agents, enabled, input.cwd, input.excludeAgentId, input.serverId],
  );

  const options = useMemo<ComboboxOption[]>(
    () =>
      candidates.map((agent) => ({
        id: agent.id,
        label: agent.title?.trim() || t("composer.attachments.conversationUntitled"),
        description: formatCompactTimeAgo(agent.lastActivityAt),
      })),
    [candidates, t],
  );

  const handleOpenChange = useCallback((next: boolean) => setOpen(next), []);

  const handleSelect = useCallback(
    (agentId: string) => {
      const { scopeKey, client } = input;
      setOpen(false);
      if (!scopeKey || !client) {
        return;
      }
      const sourceTitle =
        candidates.find((candidate) => candidate.id === agentId)?.title ?? undefined;
      void (async () => {
        try {
          const payload = await client.buildAgentForkContext(agentId);
          const attachment = buildChatHistoryAttachment({
            id: `chat_history:${agentId}`,
            serverId: input.serverId,
            agentId,
            payload,
            title: sourceTitle,
          });
          if (!attachment) {
            toast.error(t("composer.attachments.attachConversationFailed"));
            return;
          }
          useWorkspaceAttachmentsStore.getState().addWorkspaceAttachment({ scopeKey, attachment });
        } catch (error) {
          toast.error(toErrorMessage(error) || t("composer.attachments.attachConversationFailed"));
        }
      })();
    },
    [candidates, input, t, toast],
  );

  const menuItems = useMemo<AttachmentMenuItem[]>(() => {
    if (!enabled || candidates.length === 0) {
      return [];
    }
    return [
      {
        id: "chat-history",
        label: t("composer.attachments.addConversation"),
        icon: <ThemedHistoryIcon size={ICON_SIZE.md} uniProps={iconColorMapping} />,
        onSelect: () => setOpen(true),
      },
    ];
  }, [candidates.length, enabled, t]);

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
        searchPlaceholder={t("composer.attachments.conversationSearchPlaceholder")}
        title={t("composer.attachments.conversationPickerTitle")}
        open
        onOpenChange={handleOpenChange}
        desktopPlacement="top-start"
        anchorRef={input.anchorRef}
        emptyText={t("composer.attachments.conversationEmpty")}
      />
    ),
  };
}
