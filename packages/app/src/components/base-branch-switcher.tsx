import { useCallback, useMemo, useRef } from "react";
import { Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { GitFork } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { Theme } from "@/styles/theme";
import { Combobox, ComboboxItem, type ComboboxProps } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useToast } from "@/contexts/toast-context";
import { useBaseBranchSwitcher } from "@/hooks/use-base-branch-switcher";
import {
  ToolbarLabelSelectTrigger,
  ToolbarLabelTriggerIcon,
  toolbarLabelTriggerFrameStyle,
  toolbarLabelTriggerTextStyle,
} from "@/components/ui/toolbar-label-trigger";

interface BaseBranchSwitcherProps {
  baseBranchName: string | null;
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string | null;
  isGitCheckout: boolean;
  // Re-pointing the base is a worktree-only, feature-gated capability. When false the base is
  // shown read-only so it is still visible in the header.
  canChangeBase: boolean;
  testID?: string;
}

const foregroundMutedIconColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const ThemedGitFork = withUnistyles(GitFork);

export function BaseBranchSwitcher({
  baseBranchName,
  serverId,
  workspaceId,
  workspaceDirectory,
  isGitCheckout,
  canChangeBase,
  testID = "workspace-header-base-branch-switcher",
}: BaseBranchSwitcherProps) {
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const toast = useToast();
  const queryClient = useQueryClient();

  const { branchOptions, isOpen, setIsOpen, handleBaseSelect } = useBaseBranchSwitcher({
    client,
    normalizedServerId: serverId,
    normalizedWorkspaceId: workspaceId,
    workspaceDirectory,
    baseBranchName,
    isGitCheckout,
    isConnected,
    toast,
    queryClient,
  });

  const handleOpen = useCallback(() => setIsOpen(true), [setIsOpen]);

  const baseLeadingSlot = useMemo(
    () => <ThemedGitFork size={14} uniProps={foregroundMutedIconColorMapping} />,
    [],
  );

  const renderBranchOption = useCallback<NonNullable<ComboboxProps["renderOption"]>>(
    ({ option, selected, active, onPress }) => (
      <ComboboxItem
        label={option.label}
        selected={selected}
        active={active}
        onPress={onPress}
        leadingSlot={baseLeadingSlot}
      />
    ),
    [baseLeadingSlot],
  );

  if (!baseBranchName) {
    return null;
  }

  // Read-only presentation when the daemon can't change the base (old daemon) or the workspace
  // is not a worktree: keep the base visible without offering a picker.
  if (!canChangeBase) {
    return (
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <View style={[toolbarLabelTriggerFrameStyle(), styles.anchor]}>
            <ToolbarLabelTriggerIcon>
              <ThemedGitFork size={12} uniProps={foregroundMutedIconColorMapping} />
            </ToolbarLabelTriggerIcon>
            <Text testID={testID} style={toolbarLabelTriggerTextStyle(false)} numberOfLines={1}>
              {baseBranchName}
            </Text>
          </View>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>
            {t("baseBranchSwitcher.readOnlyTooltip", { branchName: baseBranchName })}
          </Text>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <View ref={anchorRef} collapsable={false} style={styles.anchor}>
      <Tooltip delayDuration={300} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild>
          <ToolbarLabelSelectTrigger
            testID={testID}
            label={baseBranchName}
            open={isOpen}
            onPress={handleOpen}
            accessibilityRole="button"
            accessibilityLabel={t("baseBranchSwitcher.currentBase", {
              branchName: baseBranchName,
            })}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <Text style={styles.tooltipText}>{t("baseBranchSwitcher.triggerTooltip")}</Text>
        </TooltipContent>
      </Tooltip>
      <Combobox
        options={branchOptions}
        value={baseBranchName}
        onSelect={handleBaseSelect}
        searchable
        placeholder={t("baseBranchSwitcher.placeholder")}
        searchPlaceholder={t("baseBranchSwitcher.searchPlaceholder")}
        emptyText={t("baseBranchSwitcher.empty")}
        title={t("baseBranchSwitcher.title")}
        open={isOpen}
        onOpenChange={setIsOpen}
        anchorRef={anchorRef}
        desktopPlacement="bottom-start"
        desktopPreventInitialFlash
        desktopMinWidth={280}
        renderOption={renderBranchOption}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  anchor: {
    flexShrink: 1,
    minWidth: 0,
  },
  tooltipText: {
    color: theme.colors.popoverForeground,
    fontSize: theme.fontSize.sm,
  },
}));
