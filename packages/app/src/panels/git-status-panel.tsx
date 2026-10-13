import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { Circle, GitCompareArrows } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelPresentation } from "@/panels/panel-registry";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { useSessionStore } from "@/stores/session-store";
import { useCheckoutStatusQuery } from "@/git/use-status-query";
import { useCheckoutPrStatusQuery } from "@/git/use-pr-status-query";
import { useCheckoutDiffQuery } from "@/git/use-diff-query";
import { useCheckoutGitActionsStore, type CheckoutGitAsyncActionId } from "@/git/actions-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { resolveFocusedChatTarget } from "@/composer/focused-chat-target";
import { useDraftStore } from "@/stores/draft-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { openExternalUrl } from "@/utils/open-external-url";
import type { Theme } from "@/styles/theme";

const ThemedGitCompareArrows = withUnistyles(GitCompareArrows);
const ThemedCircle = withUnistyles(Circle);

const gitStatusPanelPresentation = {
  label: (t) => t("panels.gitStatus.label"),
  subtitle: (t) => t("panels.gitStatus.subtitle"),
  tooltip: (t) => t("panels.gitStatus.label"),
  icon: ThemedGitCompareArrows,
} satisfies PanelPresentation;

const CENTERED_PADDED_STYLE = {
  flex: 1,
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
} as const;

type RowTone = "neutral" | "warning" | "danger" | "success";

interface RowAction {
  key: string;
  label: string;
  onPress: () => void;
  pending?: boolean;
  disabled?: boolean;
  variant?: "ghost" | "destructive";
}

interface StatusRow {
  key: string;
  tone: RowTone;
  label: string;
  actions: RowAction[];
}

function dotColorForTone(theme: Theme, tone: RowTone): string {
  const byTone: Record<RowTone, string> = {
    danger: theme.colors.statusDanger,
    warning: theme.colors.statusWarning,
    success: theme.colors.statusSuccess,
    neutral: theme.colors.foregroundMuted,
  };
  return byTone[tone];
}

const dotColorMapping = (tone: RowTone) => (theme: Theme) => ({
  color: dotColorForTone(theme, tone),
});

function GitStatusRow({ row }: { row: StatusRow }) {
  return (
    <View style={styles.row} testID={`git-status-row-${row.key}`}>
      <ThemedCircle size={16} uniProps={dotColorMapping(row.tone)} />
      <Text style={styles.rowLabel} numberOfLines={1}>
        {row.label}
      </Text>
      <View style={styles.rowActions}>
        {row.actions.map((action) => (
          <Button
            key={action.key}
            variant={action.variant ?? "ghost"}
            size="xs"
            onPress={action.onPress}
            loading={action.pending}
            disabled={action.disabled}
            testID={`git-status-action-${row.key}-${action.key}`}
          >
            {action.label}
          </Button>
        ))}
      </View>
    </View>
  );
}

function GitStatusPanel() {
  const { t } = useTranslation();
  const toast = useToast();
  const { serverId, workspaceId } = usePaneContext();
  const cwd = useWorkspaceDirectory(serverId, workspaceId) ?? "";

  const { status } = useCheckoutStatusQuery({ serverId, cwd });
  const gitStatus = status?.isGit ? status : null;
  const isGit = Boolean(gitStatus);
  const notGit = status !== null && !status.isGit && !status.error;

  const { status: prStatus, githubFeaturesEnabled } = useCheckoutPrStatusQuery({
    serverId,
    cwd,
    enabled: isGit,
  });

  const { files: uncommittedFiles } = useCheckoutDiffQuery({
    serverId,
    cwd,
    mode: "uncommitted",
    enabled: isGit && Boolean(gitStatus?.isDirty),
  });

  const conflictStateEnabled = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.gitConflictState === true,
  );
  const conflictResolutionEnabled = useSessionStore(
    (s) => s.sessions[serverId]?.serverInfo?.features?.checkoutConflictResolution === true,
  );

  const commit = useCheckoutGitActionsStore((s) => s.commit);
  const pull = useCheckoutGitActionsStore((s) => s.pull);
  const push = useCheckoutGitActionsStore((s) => s.push);
  const createPr = useCheckoutGitActionsStore((s) => s.createPr);
  const mergeFromBase = useCheckoutGitActionsStore((s) => s.mergeFromBase);
  const abortMerge = useCheckoutGitActionsStore((s) => s.abortMerge);
  const continueMerge = useCheckoutGitActionsStore((s) => s.continueMerge);

  const commitPending = useGitActionPending(serverId, cwd, "commit");
  const pullPending = useGitActionPending(serverId, cwd, "pull");
  const pushPending = useGitActionPending(serverId, cwd, "push");
  const createPrPending = useGitActionPending(serverId, cwd, "create-pr");
  const mergeFromBasePending = useGitActionPending(serverId, cwd, "merge-from-base");
  const abortPending = useGitActionPending(serverId, cwd, "abort-merge");
  const continuePending = useGitActionPending(serverId, cwd, "continue-merge");

  const workspaceKey = useMemo(
    () => buildWorkspaceTabPersistenceKey({ serverId, workspaceId }),
    [serverId, workspaceId],
  );
  const layout = useWorkspaceLayoutStore((store) =>
    workspaceKey ? store.layoutByWorkspace[workspaceKey] : undefined,
  );
  const focusTab = useWorkspaceLayoutStore((store) => store.focusTab);

  const runAction = useCallback(
    (action: () => Promise<void>, failMessage: string) => {
      void action().catch((error) => {
        toast.error(error instanceof Error ? error.message : failMessage);
      });
    },
    [toast],
  );

  const conflictedPaths = useMemo(
    () => (conflictStateEnabled ? (gitStatus?.conflictedPaths ?? []) : []),
    [conflictStateEnabled, gitStatus],
  );

  const handleAskAgent = useCallback(() => {
    const target = resolveFocusedChatTarget({ serverId, layout });
    if (!target || !workspaceKey) {
      toast.error(t("workspace.git.status.askAgentNoChat"));
      return;
    }
    const fileList = conflictedPaths.map((path) => `- ${path}`).join("\n");
    const prompt = t("workspace.git.status.askAgentPrompt", { files: fileList });
    const store = useDraftStore.getState();
    const current = store.getDraftInput(target.draftKey);
    const text = current?.text ? `${current.text}\n\n${prompt}` : prompt;
    store.saveDraftInput({
      draftKey: target.draftKey,
      draft: { text, attachments: current?.attachments ?? [] },
    });
    focusTab(workspaceKey, target.tabId);
  }, [conflictedPaths, focusTab, layout, serverId, t, toast, workspaceKey]);

  const conflictRow = useMemo<StatusRow | null>(() => {
    if (!conflictStateEnabled || conflictedPaths.length === 0) {
      return null;
    }
    const actions: RowAction[] = [
      { key: "ask-agent", label: t("workspace.git.status.askAgent"), onPress: handleAskAgent },
    ];
    if (conflictResolutionEnabled) {
      actions.push(
        {
          key: "continue",
          label: t("workspace.git.actions.continueConflict.label"),
          pending: continuePending,
          onPress: () =>
            runAction(
              () => continueMerge({ serverId, cwd }),
              t("workspace.git.actions.continueConflict.failed"),
            ),
        },
        {
          key: "abort",
          label: t("workspace.git.actions.abortConflict.label"),
          variant: "destructive",
          pending: abortPending,
          onPress: () =>
            runAction(
              () => abortMerge({ serverId, cwd }),
              t("workspace.git.actions.abortConflict.failed"),
            ),
        },
      );
    }
    return {
      key: "conflict",
      tone: "danger",
      label: t("workspace.git.status.conflicts", { count: conflictedPaths.length }),
      actions,
    };
  }, [
    abortMerge,
    abortPending,
    conflictResolutionEnabled,
    conflictStateEnabled,
    conflictedPaths,
    continueMerge,
    continuePending,
    cwd,
    handleAskAgent,
    runAction,
    serverId,
    t,
  ]);

  const prRow = useMemo<StatusRow | null>(() => {
    if (!gitStatus || !githubFeaturesEnabled) {
      return null;
    }
    if (prStatus?.url) {
      const url = prStatus.url;
      return {
        key: "pr",
        tone: "neutral",
        label: prStatus.number
          ? t("workspace.git.status.prOpen", { number: prStatus.number })
          : t("panels.pullRequest.label"),
        actions: [
          {
            key: "view",
            label: t("workspace.git.status.viewPr"),
            onPress: () => void openExternalUrl(url),
          },
        ],
      };
    }
    return {
      key: "pr",
      tone: "neutral",
      label: t("workspace.git.status.noPrOpen"),
      actions: [
        {
          key: "create",
          label: t("workspace.git.actions.createPr.label"),
          pending: createPrPending,
          disabled: (gitStatus.aheadBehind?.ahead ?? 0) === 0,
          onPress: () =>
            runAction(
              () => createPr({ serverId, cwd }),
              t("workspace.git.actions.toasts.failedCreatePr"),
            ),
        },
      ],
    };
  }, [
    createPr,
    createPrPending,
    cwd,
    gitStatus,
    githubFeaturesEnabled,
    prStatus,
    runAction,
    serverId,
    t,
  ]);

  const uncommittedRow = useMemo<StatusRow | null>(() => {
    if (!gitStatus?.isDirty) {
      return null;
    }
    return {
      key: "uncommitted",
      tone: "warning",
      label: t("workspace.git.status.uncommittedChanges", { count: uncommittedFiles.length }),
      actions: [
        {
          key: "commit",
          label: t("workspace.git.actions.commit.label"),
          pending: commitPending,
          onPress: () =>
            runAction(
              () => commit({ serverId, cwd }),
              t("workspace.git.actions.toasts.failedCommit"),
            ),
        },
      ],
    };
  }, [commit, commitPending, cwd, gitStatus, runAction, serverId, t, uncommittedFiles.length]);

  const behindBaseRow = useMemo<StatusRow | null>(() => {
    const behindBase = gitStatus?.aheadBehind?.behind ?? 0;
    if (!gitStatus || behindBase === 0 || !gitStatus.baseRef) {
      return null;
    }
    const baseRef = gitStatus.baseRef;
    return {
      key: "behind-base",
      tone: "neutral",
      label: t("workspace.git.status.behindBase", { count: behindBase, baseRef }),
      actions: [
        {
          key: "update",
          label: t("workspace.git.actions.mergeFromBase.label", { baseRef }),
          pending: mergeFromBasePending,
          disabled: gitStatus.isDirty,
          onPress: () =>
            runAction(
              () => mergeFromBase({ serverId, cwd, baseRef }),
              t("workspace.git.actions.toasts.failedMergeFromBase"),
            ),
        },
      ],
    };
  }, [cwd, gitStatus, mergeFromBase, mergeFromBasePending, runAction, serverId, t]);

  const behindRemoteRow = useMemo<StatusRow | null>(() => {
    const behind = gitStatus?.behindOfOrigin ?? 0;
    if (!gitStatus || behind === 0) {
      return null;
    }
    return {
      key: "behind-remote",
      tone: "neutral",
      label: t("workspace.git.status.behindRemote", {
        count: behind,
        remote: t("workspace.git.status.remote"),
      }),
      actions: [
        {
          key: "pull",
          label: t("workspace.git.actions.pull.label"),
          pending: pullPending,
          disabled: gitStatus.isDirty,
          onPress: () =>
            runAction(() => pull({ serverId, cwd }), t("workspace.git.actions.toasts.failedPull")),
        },
      ],
    };
  }, [cwd, gitStatus, pull, pullPending, runAction, serverId, t]);

  const toPushRow = useMemo<StatusRow | null>(() => {
    if (!gitStatus) {
      return null;
    }
    const toPush =
      gitStatus.aheadOfOrigin ?? (gitStatus.hasRemote ? (gitStatus.aheadBehind?.ahead ?? 0) : 0);
    if (toPush === 0 || (gitStatus.behindOfOrigin ?? 0) > 0) {
      return null;
    }
    return {
      key: "to-push",
      tone: "neutral",
      label: t("workspace.git.status.toPush", { count: toPush }),
      actions: [
        {
          key: "push",
          label: t("workspace.git.actions.push.label"),
          pending: pushPending,
          onPress: () =>
            runAction(() => push({ serverId, cwd }), t("workspace.git.actions.toasts.failedPush")),
        },
      ],
    };
  }, [cwd, gitStatus, push, pushPending, runAction, serverId, t]);

  const rows = useMemo<StatusRow[]>(() => {
    if (!gitStatus) {
      return [];
    }
    const ordered = [conflictRow, prRow, uncommittedRow, behindBaseRow, behindRemoteRow, toPushRow];
    const result = ordered.filter((row): row is StatusRow => row !== null);
    if (result.length === 0) {
      result.push({
        key: "up-to-date",
        tone: "success",
        label: t("workspace.git.status.upToDate"),
        actions: [],
      });
    }
    return result;
  }, [behindBaseRow, behindRemoteRow, conflictRow, gitStatus, prRow, t, toPushRow, uncommittedRow]);

  if (!cwd) {
    return (
      <View style={CENTERED_PADDED_STYLE}>
        <Text style={styles.emptyText}>{t("panels.file.directoryMissing")}</Text>
      </View>
    );
  }

  if (notGit) {
    return (
      <View style={CENTERED_PADDED_STYLE}>
        <Text style={styles.emptyText}>{t("workspace.git.diff.notRepository")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="git-status-panel">
      <Text style={styles.heading}>{t("panels.gitStatus.label")}</Text>
      <View style={styles.rows}>
        {rows.map((row) => (
          <GitStatusRow key={row.key} row={row} />
        ))}
      </View>
    </View>
  );
}

function useGitActionPending(
  serverId: string,
  cwd: string,
  actionId: CheckoutGitAsyncActionId,
): boolean {
  return useCheckoutGitActionsStore((s) => s.getStatus({ serverId, cwd, actionId }) === "pending");
}

function useStaticDescriptor(
  _target: { kind: "git_status" },
  _context: { serverId: string; workspaceId: string },
) {
  const { t }: { t: TFunction } = useTranslation();
  return {
    label: gitStatusPanelPresentation.label(t),
    subtitle: gitStatusPanelPresentation.subtitle(t),
    tooltip: gitStatusPanelPresentation.tooltip(t),
    titleState: "ready" as const,
    icon: gitStatusPanelPresentation.icon,
    statusBucket: null,
  };
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    paddingVertical: theme.spacing[3],
  },
  heading: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  rows: {
    gap: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  rowLabel: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  rowActions: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  emptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
}));

export const gitStatusPanelRegistration = definePanel("git_status", {
  component: GitStatusPanel,
  presentation: gitStatusPanelPresentation,
  useDescriptor: useStaticDescriptor,
});
