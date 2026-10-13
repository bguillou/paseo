import { useCallback, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, Text, View, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  Check,
  CircleCheck,
  CircleX,
  Copy,
  ExternalLink,
  Eye,
  FileDiff,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Reply,
  RotateCw,
} from "lucide-react-native";
import type { PressableStateCallbackType } from "react-native";
import { useTranslation } from "react-i18next";
import { openExternalUrl } from "@/utils/open-external-url";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MarkdownRenderer } from "@/components/markdown/renderer";
import { getDefaultMarkdownClipboardEnvironment } from "@/utils/rich-clipboard-default-environment";
import { writeMarkdownToRichClipboard } from "@/utils/rich-clipboard";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceAttachmentsStore } from "@/attachments/workspace-attachments-store";
import { useToast } from "@/contexts/toast-context";
import { useCheckoutGitActionsStore } from "@/git/actions-store";
import { isNative } from "@/constants/platform";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  PaneContentToolbar,
  paneContentToolbarIconSize,
  paneContentToolbarIconButtonStyle,
} from "@/components/ui/pane-content-toolbar";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { getForgePresentation, type Forge } from "@/git/forge";
import { CLIENT_FORGE_VIEW_MODULES } from "@/git/forges/view";
import type { PaneNativeContribution } from "@/git/client-forge-module";
import { PrActivitySkeleton } from "./activity-skeleton";
import {
  collapseActivity,
  expandActivity,
  getActivityState,
  getCollapsedEntryIds,
  getVisibleEntries,
} from "./activity-state";
import { formatPullRequestThreadPath } from "./activity-location";
import {
  buildPullRequestCommentContextAttachment,
  buildPullRequestCheckContextAttachment,
  buildPullRequestReviewContextAttachment,
  buildPullRequestThreadContextAttachment,
  canAddPullRequestActivityToChat,
} from "./context-attachment";
import { ChecksSection, getCheckIdentity, type ChecksRerunControls } from "./checks-section";
import { getActivityVerbKey, getStateLabelKey } from "./data";
import type { PrPaneActivity, PrPaneCheck, PrPaneData, PrReviewer, PrState } from "./data";
import { usePrStack } from "./use-pr-stack";
import type { PrStackCurrent, PrStackEntry } from "./pr-stack";
import type { ForgeSpecificStatusFacts } from "@/git/merge-capability";
import { CheckPresentationIcon } from "@/git/check-presentation.view";
import {
  buildPrTimeline,
  countResolvedThreads,
  filterResolvedEntries,
  isReviewEntryEmpty,
  type PrReviewEntry,
  type PrThreadEntry,
  type PrTimelineEntry,
} from "./timeline";
import { PrReplyComposer } from "./reply-composer";
import {
  type PrReplyTarget,
  useReplyToPrComment,
  type UseReplyToPrCommentResult,
} from "./use-reply-to-comment";
import { useResolvePrThread } from "./use-resolve-thread";
import { useRequestReview } from "./use-request-review";
import { useRerunChecks, type PrRerunChecksTarget } from "./use-rerun-checks";
import { ReviewersSection } from "./reviewers-section";
import { usePrShowResolvedToggle } from "./pr-review-view-store";
import {
  Section,
  SummaryPill,
  dangerColorMapping,
  foregroundMutedColorMapping,
  sectionKitStyles,
  successColorMapping,
} from "./section-kit";

const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedCircleX = withUnistyles(CircleX);
const ThemedCopy = withUnistyles(Copy);
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedGitMerge = withUnistyles(GitMerge);
const ThemedGitPullRequest = withUnistyles(GitPullRequest);
const ThemedGitPullRequestClosed = withUnistyles(GitPullRequestClosed);
const ThemedGitPullRequestDraft = withUnistyles(GitPullRequestDraft);
const ThemedMessageSquare = withUnistyles(MessageSquare);
const ThemedMessageSquarePlus = withUnistyles(MessageSquarePlus);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedCheck = withUnistyles(Check);
const ThemedFileDiff = withUnistyles(FileDiff);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mergedColorMapping = (theme: Theme) => ({ color: theme.colors.statusMerged });

const CLIENT_PANE_CONTRIBUTIONS: readonly PaneNativeContribution[] =
  CLIENT_FORGE_VIEW_MODULES.flatMap((module) => module.paneContributions ?? []);

function resolvePaneContribution(
  facts: ForgeSpecificStatusFacts | undefined,
): PaneNativeContribution | null {
  if (!facts) {
    return null;
  }
  return CLIENT_PANE_CONTRIBUTIONS.find((contribution) => contribution.guard(facts)) ?? null;
}

type IconColorMapping = typeof foregroundColorMapping;

interface PrStatePresentation {
  Icon: typeof ThemedGitPullRequest;
  iconColor: IconColorMapping;
}

const PR_STATE_PRESENTATION: Record<PrState, PrStatePresentation> = {
  open: { Icon: ThemedGitPullRequest, iconColor: successColorMapping },
  draft: { Icon: ThemedGitPullRequestDraft, iconColor: foregroundMutedColorMapping },
  merged: { Icon: ThemedGitMerge, iconColor: mergedColorMapping },
  closed: { Icon: ThemedGitPullRequestClosed, iconColor: dangerColorMapping },
};

const SUMMARY_COMMENT_ICON = (
  <ThemedMessageSquare size={11} uniProps={foregroundMutedColorMapping} />
);
const STACK_SUMMARY_ICON = (
  <ThemedGitPullRequest size={11} uniProps={foregroundMutedColorMapping} />
);
const SUMMARY_APPROVAL_ICON = <CheckPresentationIcon presentation="success" size={12} />;
const SUMMARY_CHANGES_REQUESTED_ICON = <CheckPresentationIcon presentation="failure" size={12} />;
const ADD_TO_CHAT_MENU_ICON = (
  <ThemedMessageSquarePlus size={14} uniProps={foregroundMutedColorMapping} />
);
const COPY_MENU_ICON = <ThemedCopy size={14} uniProps={foregroundMutedColorMapping} />;
const OPEN_MENU_ICON = <ThemedExternalLink size={14} uniProps={foregroundMutedColorMapping} />;
const RESOLVE_MENU_ICON = <ThemedCheck size={14} uniProps={foregroundMutedColorMapping} />;
const OPEN_IN_DIFF_MENU_ICON = <ThemedFileDiff size={14} uniProps={foregroundMutedColorMapping} />;

function handleMarkdownLinkPress(url: string): boolean {
  void openExternalUrl(url);
  return false;
}

function entryHeaderPressableStyle({ hovered }: { hovered?: boolean }) {
  return [styles.entryHeaderPressable, Boolean(hovered) && styles.hoverable];
}

function kebabTriggerStyle({
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.kebabButton, hovered && styles.kebabButtonHovered];
}

function stackRowPressableStyle({ hovered }: { hovered?: boolean }) {
  return [styles.stackRow, Boolean(hovered) && styles.hoverable];
}

function PrStackSection({
  stack,
  forge,
  open,
  onToggle,
}: {
  stack: PrStackEntry[];
  forge: Forge;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const numberPrefix = getForgePresentation(forge).numberPrefix;
  const summary = useMemo(
    () => <SummaryPill count={stack.length} icon={STACK_SUMMARY_ICON} variant="muted" />,
    [stack.length],
  );
  return (
    <>
      <Section
        title={t("workspace.git.pr.sections.stack")}
        open={open}
        onToggle={onToggle}
        summary={summary}
      >
        <View style={styles.stackList} testID="pr-pane-stack">
          {stack.map((entry) => (
            <PrStackRow
              key={entry.number}
              entry={entry}
              numberPrefix={numberPrefix}
              currentLabel={t("workspace.git.pr.stack.current")}
            />
          ))}
        </View>
      </Section>
      <View style={styles.divider} />
    </>
  );
}

function PrStackRow({
  entry,
  numberPrefix,
  currentLabel,
}: {
  entry: PrStackEntry;
  numberPrefix: string;
  currentLabel: string;
}) {
  const presentation = PR_STATE_PRESENTATION[entry.state];
  const StateIcon = presentation.Icon;
  const handlePress = useCallback(() => {
    void openExternalUrl(entry.url);
  }, [entry.url]);
  return (
    <Pressable
      accessibilityRole="button"
      style={stackRowPressableStyle}
      onPress={handlePress}
      testID={`pr-pane-stack-row-${entry.number}`}
    >
      <StateIcon size={14} uniProps={presentation.iconColor} />
      <Text style={styles.stackNumber}>
        {numberPrefix}
        {entry.number}
      </Text>
      <Text
        style={entry.isCurrent ? styles.stackTitleCurrent : styles.stackTitle}
        numberOfLines={1}
      >
        {entry.title}
      </Text>
      {entry.isCurrent ? (
        <View style={styles.stackCurrentBadge}>
          <Text style={styles.stackCurrentBadgeText}>{currentLabel}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function refreshButtonStyle(
  { hovered, pressed }: PressableStateCallbackType & { hovered?: boolean },
  isCompact: boolean,
) {
  return paneContentToolbarIconButtonStyle({ hovered, pressed }, false, isCompact);
}

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreHorizontal
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

function addLoadingCheck(current: ReadonlySet<string>, checkKey: string): ReadonlySet<string> {
  if (current.has(checkKey)) {
    return current;
  }
  const next = new Set(current);
  next.add(checkKey);
  return next;
}

function removeLoadingCheck(current: ReadonlySet<string>, checkKey: string): ReadonlySet<string> {
  if (!current.has(checkKey)) {
    return current;
  }
  const next = new Set(current);
  next.delete(checkKey);
  return next;
}

function PrActivityToolbar({
  showAddAll,
  activityLoading,
  onAddAllToChat,
  resolvedThreadCount,
  showResolved,
  onToggleShowResolved,
}: {
  showAddAll: boolean;
  activityLoading: boolean;
  onAddAllToChat: () => void;
  resolvedThreadCount: number;
  showResolved: boolean;
  onToggleShowResolved: () => void;
}) {
  const { t } = useTranslation();
  if (!showAddAll && resolvedThreadCount === 0) {
    return null;
  }
  return (
    <View style={styles.activityToolbar}>
      {showAddAll ? (
        <Button
          variant="ghost"
          size="xs"
          leftIcon={MessageSquarePlus}
          onPress={onAddAllToChat}
          disabled={activityLoading}
        >
          {t("workspace.git.pr.actions.addAllToChat")}
        </Button>
      ) : null}
      {resolvedThreadCount > 0 ? (
        <Button
          variant="ghost"
          size="xs"
          leftIcon={Eye}
          onPress={onToggleShowResolved}
          testID="pr-toggle-show-resolved"
        >
          {showResolved
            ? t("workspace.git.pr.actions.hideResolved")
            : t("workspace.git.pr.actions.showResolved")}
        </Button>
      ) : null}
    </View>
  );
}

export function PullRequestPane({
  serverId,
  cwd,
  data,
  activityLoading,
  workspaceAttachmentScopeKey,
  onOpenInDiff,
}: {
  serverId: string;
  cwd: string;
  data: PrPaneData;
  activityLoading: boolean;
  workspaceAttachmentScopeKey?: string;
  /** Opens the diff scrolled to a comment's file + line. Undefined when unavailable. */
  onOpenInDiff?: (location: { path: string; line: number }) => void;
}) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const toolbarRefreshButtonStyle = useCallback(
    (state: PressableStateCallbackType) => refreshButtonStyle(state, isCompact),
    [isCompact],
  );
  const toast = useToast();
  const daemonClient = useHostRuntimeClient(serverId);
  // COMPAT(githubCheckDetailsRpc): recognize the legacy capability on daemons
  // predating checkout.forge.get_check_details.*. Remove after 2027-01-17 once
  // the supported daemon floor is >= v0.2.0.
  const canFetchGitHubCheckDetails = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.githubCheckDetails === true,
  );
  const canFetchForgeCheckDetails = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.forgeCheckDetails === true,
  );
  const forgeProvidersEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.forgeProviders === true,
  );
  const forgeSearchEnabled = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.forgeSearch === true,
  );
  const addWorkspaceAttachment = useWorkspaceAttachmentsStore(
    (state) => state.addWorkspaceAttachment,
  );
  const replyController = useReplyToPrComment({ serverId, cwd });
  const resolveController = useResolvePrThread({ serverId, cwd });
  const requestReviewController = useRequestReview({ serverId, cwd });
  const rerunController = useRerunChecks({ serverId, cwd });
  const { showResolved, toggleShowResolved } = usePrShowResolvedToggle(serverId, cwd);
  const replyContext = useMemo(
    () => ({
      prNumber: data.number,
      ...(data.repoOwner ? { repoOwner: data.repoOwner } : {}),
      ...(data.repoName ? { repoName: data.repoName } : {}),
    }),
    [data.number, data.repoName, data.repoOwner],
  );
  const [checksOpen, setChecksOpen] = useState(true);
  const [activityOpen, setActivityOpen] = useState(true);
  const [stackOpen, setStackOpen] = useState(true);
  const [reviewersOpen, setReviewersOpen] = useState(true);

  const stackCurrent = useMemo<PrStackCurrent>(
    () => ({
      number: data.number,
      title: data.title,
      state: data.state,
      url: data.url,
      headRefName: data.headRefName,
      baseRefName: data.baseRefName,
    }),
    [data.number, data.title, data.state, data.url, data.headRefName, data.baseRefName],
  );
  const { stack } = usePrStack({
    serverId,
    cwd,
    current: stackCurrent,
    forge: data.forge,
    enabled: forgeSearchEnabled,
  });
  const [activityState, setActivityState] = useState(getActivityState);
  const [loadingCheckKeys, setLoadingCheckKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [rerunningCheckKeys, setRerunningCheckKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [isRerunningFailed, setIsRerunningFailed] = useState(false);

  const handleOpenPrUrl = useCallback(() => {
    void openExternalUrl(data.url);
  }, [data.url]);

  const refreshSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.checkoutRefresh === true,
  );
  const runRefresh = useCheckoutGitActionsStore((state) => state.refresh);
  const isRefreshing =
    useCheckoutGitActionsStore((state) =>
      state.getStatus({ serverId, cwd, actionId: "refresh" }),
    ) === "pending";

  const handleRefresh = useCallback(() => {
    if (isRefreshing) {
      return;
    }
    void runRefresh({ serverId, cwd }).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("workspace.git.diff.failedRefresh"));
    });
  }, [cwd, isRefreshing, runRefresh, serverId, t, toast]);

  const handleToggleChecks = useCallback(() => {
    setChecksOpen((open) => !open);
  }, []);

  const handleToggleActivity = useCallback(() => {
    setActivityOpen((open) => !open);
  }, []);

  const handleToggleStack = useCallback(() => {
    setStackOpen((open) => !open);
  }, []);

  const handleToggleReviewers = useCallback(() => {
    setReviewersOpen((open) => !open);
  }, []);

  const handleRequestReview = useCallback(
    async (reviewer: PrReviewer) => {
      const result = await requestReviewController.requestReview({
        prNumber: data.number,
        reviewerLogin: reviewer.login,
        ...(data.repoOwner ? { repoOwner: data.repoOwner } : {}),
        ...(data.repoName ? { repoName: data.repoName } : {}),
      });
      if (!result.ok && result.error) {
        toast.error(result.error);
      }
    },
    [data.number, data.repoName, data.repoOwner, requestReviewController, toast],
  );

  const approvals = data.activity.filter(
    (item) => item.kind === "review" && item.reviewState === "approved",
  ).length;
  const changesRequested = data.activity.filter(
    (item) => item.kind === "review" && item.reviewState === "changes_requested",
  ).length;
  const commentCount = data.activity.filter(
    (item) =>
      item.kind === "comment" || (item.kind === "review" && item.reviewState === "commented"),
  ).length;

  const allTimelineEntries = useMemo(() => buildPrTimeline(data.activity), [data.activity]);
  const resolvedThreadCount = useMemo(
    () => countResolvedThreads(allTimelineEntries),
    [allTimelineEntries],
  );
  // Resolved threads are hidden until the toggle reveals them.
  const timelineEntries = useMemo(
    () => filterResolvedEntries(allTimelineEntries, showResolved),
    [allTimelineEntries, showResolved],
  );
  const visibleEntries = useMemo(
    () =>
      getVisibleEntries(activityState, {
        prNumber: data.number,
        entries: timelineEntries,
      }),
    [activityState, data.number, timelineEntries],
  );
  const collapsedEntryIds = useMemo(
    () => getCollapsedEntryIds(activityState, { prNumber: data.number, entries: timelineEntries }),
    [activityState, data.number, timelineEntries],
  );
  const attachEnabled = workspaceAttachmentScopeKey !== undefined;

  const handleAddActivityToChat = useCallback(
    (activity: PrPaneActivity) => {
      if (!workspaceAttachmentScopeKey || !canAddPullRequestActivityToChat(activity)) {
        return;
      }
      const input = {
        provider: data.provider,
        forge: data.forge,
        pullRequest: { number: data.number, title: data.title, url: data.url },
        activity,
      };
      const attachment =
        activity.kind === "comment"
          ? buildPullRequestCommentContextAttachment(input)
          : buildPullRequestReviewContextAttachment(input);
      if (!attachment) {
        return;
      }
      addWorkspaceAttachment({
        scopeKey: workspaceAttachmentScopeKey,
        attachment,
      });
    },
    [
      addWorkspaceAttachment,
      data.forge,
      data.number,
      data.provider,
      data.title,
      data.url,
      workspaceAttachmentScopeKey,
    ],
  );

  const handleAddThreadToChat = useCallback(
    (thread: PrThreadEntry) => {
      if (!workspaceAttachmentScopeKey) {
        return;
      }
      const attachment = buildPullRequestThreadContextAttachment({
        provider: data.provider,
        forge: data.forge,
        pullRequest: { number: data.number, title: data.title, url: data.url },
        thread,
      });
      if (!attachment) {
        return;
      }
      addWorkspaceAttachment({
        scopeKey: workspaceAttachmentScopeKey,
        attachment,
      });
    },
    [
      addWorkspaceAttachment,
      data.forge,
      data.number,
      data.provider,
      data.title,
      data.url,
      workspaceAttachmentScopeKey,
    ],
  );

  const handleResolveThread = useCallback(
    (thread: PrThreadEntry, resolved: boolean) => {
      const root = thread.comments[0];
      const threadId = root?.location?.threadId ?? root?.threadId;
      if (!threadId) {
        return;
      }
      void (async () => {
        const result = await resolveController.setResolved({
          prNumber: data.number,
          threadId,
          resolved,
          ...(data.repoOwner ? { repoOwner: data.repoOwner } : {}),
          ...(data.repoName ? { repoName: data.repoName } : {}),
        });
        if (!result.ok && result.error) {
          toast.error(result.error);
        }
      })();
    },
    [data.number, data.repoName, data.repoOwner, resolveController, toast],
  );

  const handleOpenThreadInDiff = useCallback(
    (thread: PrThreadEntry) => {
      const location = thread.location;
      if (!onOpenInDiff || !location || location.line === undefined || location.isOutdated) {
        return;
      }
      onOpenInDiff({ path: location.path, line: location.line });
    },
    [onOpenInDiff],
  );

  const handleAddAllToChat = useCallback(() => {
    for (const { entry } of visibleEntries) {
      if (entry.kind === "single") {
        handleAddActivityToChat(entry.activity);
        continue;
      }
      if (entry.kind === "review") {
        handleAddActivityToChat(entry.review);
      }
      const threads = entry.kind === "thread" ? [entry] : entry.threads;
      for (const thread of threads) {
        if (thread.isResolved === true) {
          continue;
        }
        handleAddThreadToChat(thread);
      }
    }
  }, [handleAddActivityToChat, handleAddThreadToChat, visibleEntries]);

  const handleAddCheckLogsToChat = useCallback(
    async (check: PrPaneCheck) => {
      if (!workspaceAttachmentScopeKey) {
        return;
      }
      const checkKey = getCheckIdentity(check);
      setLoadingCheckKeys((current) => addLoadingCheck(current, checkKey));

      let details = null;
      try {
        const ref = check.detailRef;
        // The neutral forge RPC fetches detail for any forge; fall back to the
        // legacy github-only RPC only for GitHub against a daemon that predates
        // it. A non-GitHub forge therefore needs the neutral capability present.
        const canFetchDetail =
          canFetchForgeCheckDetails || (check.provider === "github" && canFetchGitHubCheckDetails);
        if (
          canFetchDetail &&
          daemonClient &&
          (ref?.checkRunId !== undefined || ref?.workflowRunId !== undefined) &&
          data.repoOwner &&
          data.repoName
        ) {
          try {
            const request = {
              cwd,
              repoOwner: data.repoOwner,
              repoName: data.repoName,
              checkRunId: ref.checkRunId,
              workflowRunId: ref.workflowRunId,
              changeRequestNumber: data.number,
            };
            // COMPAT(githubCheckDetailsRpc): use the legacy GitHub RPC with
            // daemons predating checkout.forge.get_check_details.*. Remove after
            // 2027-01-17 once the supported daemon floor is >= v0.2.0.
            const payload = canFetchForgeCheckDetails
              ? await daemonClient.checkoutForgeGetCheckDetails(request)
              : await daemonClient.checkoutGithubGetCheckDetails(request);
            details = payload.success ? payload.details : null;
          } catch {
            details = null;
          }
        }
        const attachment = buildPullRequestCheckContextAttachment({
          provider: data.provider,
          forge: data.forge,
          pullRequest: { number: data.number, title: data.title, url: data.url },
          check,
          githubDetails: details,
        });
        addWorkspaceAttachment({
          scopeKey: workspaceAttachmentScopeKey,
          attachment,
        });
      } catch {
        // The check row should recover even if attachment formatting or insertion fails.
      } finally {
        setLoadingCheckKeys((current) => removeLoadingCheck(current, checkKey));
      }
    },
    [
      addWorkspaceAttachment,
      canFetchForgeCheckDetails,
      canFetchGitHubCheckDetails,
      cwd,
      daemonClient,
      data.forge,
      data.number,
      data.provider,
      data.repoName,
      data.repoOwner,
      data.title,
      data.url,
      workspaceAttachmentScopeKey,
    ],
  );

  const handleRerunCheck = useCallback(
    async (check: PrPaneCheck) => {
      const ref = check.detailRef;
      // Prefer the check run (re-runs that one job); fall back to the whole run.
      let target: PrRerunChecksTarget | null = null;
      if (ref?.checkRunId !== undefined) {
        target = { mode: "check", checkRunId: ref.checkRunId };
      } else if (ref?.workflowRunId !== undefined) {
        target = { mode: "run", workflowRunId: ref.workflowRunId };
      }
      if (!target) {
        return;
      }
      const checkKey = getCheckIdentity(check);
      setRerunningCheckKeys((current) => addLoadingCheck(current, checkKey));
      try {
        const result = await rerunController.rerunChecks({
          prNumber: data.number,
          target,
          ...(data.repoOwner ? { repoOwner: data.repoOwner } : {}),
          ...(data.repoName ? { repoName: data.repoName } : {}),
        });
        if (!result.ok && result.error) {
          toast.error(result.error);
        }
      } finally {
        setRerunningCheckKeys((current) => removeLoadingCheck(current, checkKey));
      }
    },
    [data.number, data.repoName, data.repoOwner, rerunController, toast],
  );

  const handleRerunFailed = useCallback(async () => {
    // "Re-run failed jobs" is a per-workflow-run operation; a PR's failed checks
    // can span several runs, so fire one request per distinct run id.
    const runIds = new Set<number>();
    for (const check of data.checks) {
      if (check.status === "failure" && check.detailRef?.workflowRunId !== undefined) {
        runIds.add(check.detailRef.workflowRunId);
      }
    }
    if (runIds.size === 0) {
      return;
    }
    setIsRerunningFailed(true);
    try {
      for (const workflowRunId of runIds) {
        const result = await rerunController.rerunChecks({
          prNumber: data.number,
          target: { mode: "failed", workflowRunId },
          ...(data.repoOwner ? { repoOwner: data.repoOwner } : {}),
          ...(data.repoName ? { repoName: data.repoName } : {}),
        });
        if (!result.ok && result.error) {
          toast.error(result.error);
          break;
        }
      }
    } finally {
      setIsRerunningFailed(false);
    }
  }, [data.checks, data.number, data.repoName, data.repoOwner, rerunController, toast]);

  const canRerunFailed = useMemo(
    () =>
      data.checks.some(
        (check) => check.status === "failure" && check.detailRef?.workflowRunId !== undefined,
      ),
    [data.checks],
  );
  const rerunControls = useMemo<ChecksRerunControls | undefined>(() => {
    if (!rerunController.enabled) {
      return undefined;
    }
    return {
      onRerunCheck: handleRerunCheck,
      rerunningCheckKeys,
      onRerunFailed: handleRerunFailed,
      isRerunningFailed,
      canRerunFailed,
    };
  }, [
    canRerunFailed,
    handleRerunCheck,
    handleRerunFailed,
    isRerunningFailed,
    rerunController.enabled,
    rerunningCheckKeys,
  ]);

  const handleToggleEntryCollapsed = useCallback(
    (entryId: string, collapsed: boolean) => {
      setActivityState((current) => {
        const identity = { prNumber: data.number, activityId: entryId };
        return collapsed ? expandActivity(current, identity) : collapseActivity(current, identity);
      });
    },
    [data.number],
  );

  const statePresentation = PR_STATE_PRESENTATION[data.state];
  const StateIcon = statePresentation.Icon;
  const forgePresentation = getForgePresentation(data.forge);
  const repoIdentity =
    data.projectPath ??
    (data.repoOwner && data.repoName ? `${data.repoOwner}/${data.repoName}` : null);

  // Native forge surfaces (e.g. GitLab approvals/pipeline) come from a registry
  // keyed by the facts-family, so the central render has no per-forge branch.
  const nativeContribution = resolvePaneContribution(data.forgeSpecific);
  const nativeHeaderMeta = data.forgeSpecific
    ? nativeContribution?.renderHeaderMeta(data.forgeSpecific)
    : null;
  const nativeChecksSection = data.forgeSpecific
    ? nativeContribution?.renderChecksSection(data.forgeSpecific, {
        serverId,
        cwd,
        changeRequestNumber: data.number,
        open: checksOpen,
        onToggle: handleToggleChecks,
        enabled: forgeProvidersEnabled,
        canFetchCheckDetails: canFetchForgeCheckDetails,
      })
    : null;

  return (
    <View style={styles.root} testID="pr-pane">
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <PaneContentToolbar style={styles.toolbar} testID="pr-pane-toolbar">
          <View style={styles.toolbarActions}>
            <Button
              variant="ghost"
              size="xs"
              leftIcon={ExternalLink}
              onPress={handleOpenPrUrl}
              style={styles.viewButton}
              testID="pr-pane-view-pr"
            >
              {t("workspace.git.pr.actions.viewPullRequest")}
            </Button>
          </View>
          {refreshSupported ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                isRefreshing
                  ? t("workspace.git.diff.refreshing")
                  : t("workspace.git.diff.refreshState", { brand: forgePresentation.brandLabel })
              }
              testID="pr-pane-refresh"
              style={toolbarRefreshButtonStyle}
              hitSlop={8}
              onPress={handleRefresh}
              disabled={isRefreshing}
            >
              <View style={styles.refreshIcon}>
                {isRefreshing ? (
                  <ThemedLoadingSpinner
                    size={paneContentToolbarIconSize(isCompact)}
                    uniProps={foregroundMutedColorMapping}
                  />
                ) : (
                  <ThemedRotateCw
                    size={paneContentToolbarIconSize(isCompact)}
                    uniProps={foregroundMutedColorMapping}
                  />
                )}
              </View>
            </Pressable>
          ) : null}
        </PaneContentToolbar>

        <Pressable onPress={handleOpenPrUrl} style={styles.header}>
          {({ hovered }) => (
            <>
              <Text style={styles.title} testID="pr-pane-title">
                {data.title}
                <Text style={styles.titleNumber}>
                  {" "}
                  {forgePresentation.numberPrefix}
                  {data.number}
                </Text>
              </Text>
              <View style={styles.metaLine}>
                <StateIcon size={14} uniProps={statePresentation.iconColor} />
                <Text style={stateLabelStyle(data.state)} testID="pr-pane-state">
                  {t(getStateLabelKey(data.state))}
                </Text>
                {nativeHeaderMeta}
                {repoIdentity ? (
                  <Text style={styles.repoRef} numberOfLines={1}>
                    {repoIdentity}
                  </Text>
                ) : null}
                <View style={hovered ? styles.headerLinkIcon : styles.headerLinkIconHidden}>
                  <ThemedExternalLink size={12} uniProps={foregroundMutedColorMapping} />
                </View>
              </View>
            </>
          )}
        </Pressable>

        {stack.length >= 2 ? (
          <PrStackSection
            stack={stack}
            forge={data.forge}
            open={stackOpen}
            onToggle={handleToggleStack}
          />
        ) : null}

        {nativeChecksSection ?? (
          <ChecksSection
            checks={data.checks}
            open={checksOpen}
            onToggle={handleToggleChecks}
            attachEnabled={attachEnabled}
            loadingCheckKeys={loadingCheckKeys}
            onAddLogsToChat={handleAddCheckLogsToChat}
            rerun={rerunControls}
          />
        )}

        {data.reviewers.length > 0 ? (
          <>
            <View style={styles.divider} />
            <ReviewersSection
              reviewers={data.reviewers}
              open={reviewersOpen}
              onToggle={handleToggleReviewers}
              canRequestReview={requestReviewController.enabled}
              onRequestReview={handleRequestReview}
            />
          </>
        ) : null}

        <View style={styles.divider} />

        <Section
          title={t("workspace.git.pr.sections.activity")}
          open={activityOpen}
          onToggle={handleToggleActivity}
          summary={
            <>
              <SummaryPill count={approvals} icon={SUMMARY_APPROVAL_ICON} variant="success" />
              <SummaryPill
                count={changesRequested}
                icon={SUMMARY_CHANGES_REQUESTED_ICON}
                variant="danger"
              />
              <SummaryPill count={commentCount} icon={SUMMARY_COMMENT_ICON} variant="muted" />
            </>
          }
        >
          {activityLoading ? null : (
            <PrActivityToolbar
              showAddAll={attachEnabled && visibleEntries.length > 0}
              activityLoading={activityLoading}
              onAddAllToChat={handleAddAllToChat}
              resolvedThreadCount={resolvedThreadCount}
              showResolved={showResolved}
              onToggleShowResolved={toggleShowResolved}
            />
          )}
          {activityLoading ? <PrActivitySkeleton /> : null}
          {!activityLoading && visibleEntries.length === 0 ? (
            <Text style={sectionKitStyles.emptyText}>{t("workspace.git.pr.empty.noActivity")}</Text>
          ) : null}
          {!activityLoading
            ? visibleEntries.map(({ entry, collapsed }) => (
                <TimelineEntryCard
                  key={entry.id}
                  entry={entry}
                  collapsed={collapsed}
                  collapsedEntryIds={collapsedEntryIds}
                  attachEnabled={attachEnabled}
                  brandLabel={forgePresentation.brandLabel}
                  onAddToChat={handleAddActivityToChat}
                  onAddThreadToChat={handleAddThreadToChat}
                  onToggleCollapsed={handleToggleEntryCollapsed}
                  onResolveThread={resolveController.enabled ? handleResolveThread : undefined}
                  onOpenThreadInDiff={onOpenInDiff ? handleOpenThreadInDiff : undefined}
                  replyController={replyController}
                  replyContext={replyContext}
                />
              ))
            : null}
        </Section>
      </ScrollView>
    </View>
  );
}

function stateLabelStyle(state: PrState) {
  if (state === "open") return styles.stateLabelOpen;
  if (state === "draft") return styles.stateLabelDraft;
  if (state === "merged") return styles.stateLabelMerged;
  return styles.stateLabelClosed;
}

interface TimelineEntryCallbacks {
  attachEnabled: boolean;
  brandLabel: string;
  onAddToChat: (activity: PrPaneActivity) => void;
  onAddThreadToChat: (thread: PrThreadEntry) => void;
  onToggleCollapsed: (entryId: string, collapsed: boolean) => void;
  /** Resolves/reopens a thread. Undefined when the daemon can't resolve threads. */
  onResolveThread?: (thread: PrThreadEntry, resolved: boolean) => void;
  /** Jumps to the thread's line inline in the diff. Undefined when unavailable. */
  onOpenThreadInDiff?: (thread: PrThreadEntry) => void;
  replyController: UseReplyToPrCommentResult;
  replyContext: { prNumber: number; repoOwner?: string; repoName?: string };
}

/** Builds the forge-neutral reply target for a thread from the PR context. */
function buildThreadReplyTarget(
  thread: PrThreadEntry,
  context: { prNumber: number; repoOwner?: string; repoName?: string },
): PrReplyTarget {
  const root = thread.comments[0];
  const threadId = root?.location?.threadId ?? root?.threadId;
  return {
    prNumber: context.prNumber,
    ...(context.repoOwner ? { repoOwner: context.repoOwner } : {}),
    ...(context.repoName ? { repoName: context.repoName } : {}),
    ...(threadId ? { threadId } : {}),
    ...(thread.location
      ? {
          location: {
            path: thread.location.path,
            ...(thread.location.line ? { line: thread.location.line } : {}),
          },
        }
      : { isGeneralDiscussion: true }),
  };
}

function TimelineEntryCard({
  entry,
  collapsed,
  collapsedEntryIds,
  ...callbacks
}: TimelineEntryCallbacks & {
  entry: PrTimelineEntry;
  collapsed: boolean;
  collapsedEntryIds: ReadonlySet<string>;
}) {
  if (entry.kind === "thread") {
    return <ThreadCard entry={entry} collapsed={collapsed} {...callbacks} />;
  }
  if (entry.kind === "review") {
    return (
      <ReviewCard
        entry={entry}
        collapsed={collapsed}
        collapsedEntryIds={collapsedEntryIds}
        {...callbacks}
      />
    );
  }
  return <SingleActivityCard entry={entry} collapsed={collapsed} {...callbacks} />;
}

function useRevealOnHover() {
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const actionsVisible = isHovered || menuOpen || isNative || isCompact;
  return { actionsVisible, handlePointerEnter, handlePointerLeave, setMenuOpen };
}

function ActivityKebab({
  activity,
  visible,
  attachEnabled,
  brandLabel,
  onMenuOpenChange,
  onAddToChat,
}: {
  activity: PrPaneActivity;
  visible: boolean;
  attachEnabled: boolean;
  brandLabel: string;
  onMenuOpenChange: (open: boolean) => void;
  onAddToChat: (activity: PrPaneActivity) => void;
}) {
  const { t } = useTranslation();
  const handleAddToChat = useCallback(() => onAddToChat(activity), [activity, onAddToChat]);
  const handleCopy = useCallback(() => {
    void writeMarkdownToRichClipboard(activity.body, getDefaultMarkdownClipboardEnvironment());
  }, [activity.body]);
  const handleOpen = useCallback(() => {
    void openExternalUrl(activity.url);
  }, [activity.url]);

  return (
    <View style={kebabSlotStyle(visible)} pointerEvents={visible ? "auto" : "none"}>
      <DropdownMenu onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger
          hitSlop={8}
          style={kebabTriggerStyle}
          accessibilityLabel={t("workspace.git.pr.accessibility.commentActions")}
        >
          {renderKebabTriggerIcon}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={200}>
          {attachEnabled && canAddPullRequestActivityToChat(activity) ? (
            <DropdownMenuItem leading={ADD_TO_CHAT_MENU_ICON} onSelect={handleAddToChat}>
              {t("workspace.git.pr.actions.addToChat")}
            </DropdownMenuItem>
          ) : null}
          {activity.body.trim() !== "" ? (
            <DropdownMenuItem leading={COPY_MENU_ICON} onSelect={handleCopy}>
              Copy
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem leading={OPEN_MENU_ICON} onSelect={handleOpen}>
            {t("workspace.git.pr.actions.openOn", { brand: brandLabel })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function kebabSlotStyle(visible: boolean) {
  return visible ? styles.kebabSlot : styles.kebabSlotHidden;
}

function ActivityAvatar({ activity, size }: { activity: PrPaneActivity; size: number }) {
  const frameStyle = useMemo(
    () => [
      styles.avatar,
      {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: activity.avatarColor,
      },
    ],
    [activity.avatarColor, size],
  );
  const imageStyle = useMemo(() => ({ width: size, height: size, borderRadius: size / 2 }), [size]);
  const imageSource = useMemo(
    () => (activity.avatarUrl ? { uri: activity.avatarUrl } : null),
    [activity.avatarUrl],
  );
  return (
    <View style={frameStyle}>
      {imageSource ? (
        <Image source={imageSource} style={imageStyle} />
      ) : (
        <Text style={styles.avatarText}>{activity.author.slice(0, 1).toUpperCase()}</Text>
      )}
    </View>
  );
}

function ActivityVerb({ activity }: { activity: PrPaneActivity }) {
  const { t } = useTranslation();
  const verb = t(getActivityVerbKey(activity)).toLowerCase();
  if (activity.kind === "review" && activity.reviewState === "approved") {
    return (
      <View style={styles.verbGroup}>
        <ThemedCircleCheck size={12} uniProps={successColorMapping} />
        <Text style={styles.verbSuccess}>{verb}</Text>
      </View>
    );
  }
  if (activity.kind === "review" && activity.reviewState === "changes_requested") {
    return (
      <View style={styles.verbGroup}>
        <ThemedCircleX size={12} uniProps={dangerColorMapping} />
        <Text style={styles.verbDanger}>{verb}</Text>
      </View>
    );
  }
  return <Text style={styles.verbMuted}>{verb}</Text>;
}

function ActivityHeader({
  activity,
  avatarSize,
  children,
}: {
  activity: PrPaneActivity;
  avatarSize: number;
  children?: React.ReactNode;
}) {
  return (
    <>
      <ActivityAvatar activity={activity} size={avatarSize} />
      <Text style={styles.authorText} numberOfLines={1}>
        {activity.author}
      </Text>
      <ActivityVerb activity={activity} />
      <View style={styles.headerTrailing}>
        <Text style={styles.ageText}>{activity.age}</Text>
        {children}
      </View>
    </>
  );
}

function SingleActivityCard({
  entry,
  collapsed,
  attachEnabled,
  brandLabel,
  onAddToChat,
  onToggleCollapsed,
}: TimelineEntryCallbacks & {
  entry: Extract<PrTimelineEntry, { kind: "single" }>;
  collapsed: boolean;
}) {
  const { t } = useTranslation();
  const { activity } = entry;
  const { actionsVisible, handlePointerEnter, handlePointerLeave, setMenuOpen } =
    useRevealOnHover();
  const hasBody = activity.body.trim() !== "";
  const handleAddToChat = useCallback(() => onAddToChat(activity), [activity, onAddToChat]);
  const handleHeaderPress = useCallback(() => {
    if (hasBody) {
      onToggleCollapsed(entry.id, collapsed);
      return;
    }
    void openExternalUrl(activity.url);
  }, [activity.url, collapsed, entry.id, hasBody, onToggleCollapsed]);

  if (!hasBody) {
    return (
      <View
        style={styles.eventRow}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        testID="pr-pane-activity-row"
      >
        <Pressable onPress={handleHeaderPress} style={entryHeaderPressableStyle}>
          <ActivityHeader activity={activity} avatarSize={20}>
            <ActivityKebab
              activity={activity}
              visible={actionsVisible}
              attachEnabled={attachEnabled}
              brandLabel={brandLabel}
              onMenuOpenChange={setMenuOpen}
              onAddToChat={onAddToChat}
            />
          </ActivityHeader>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={styles.card}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      testID="pr-pane-activity-row"
    >
      <Pressable onPress={handleHeaderPress} style={entryHeaderPressableStyle}>
        <ActivityHeader activity={activity} avatarSize={20}>
          <ActivityKebab
            activity={activity}
            visible={actionsVisible}
            attachEnabled={attachEnabled}
            brandLabel={brandLabel}
            onMenuOpenChange={setMenuOpen}
            onAddToChat={onAddToChat}
          />
        </ActivityHeader>
      </Pressable>
      {collapsed ? null : (
        <>
          <View style={styles.cardBody}>
            <MarkdownRenderer
              text={activity.body}
              compact
              imagePreview
              onLinkPress={handleMarkdownLinkPress}
            />
          </View>
          {attachEnabled && canAddPullRequestActivityToChat(activity) ? (
            <View style={styles.cardFooter}>
              <Button
                variant="ghost"
                size="xs"
                leftIcon={MessageSquarePlus}
                onPress={handleAddToChat}
              >
                {t("workspace.git.pr.actions.addToChat")}
              </Button>
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function ThreadCard({
  entry,
  collapsed,
  attachEnabled,
  brandLabel,
  onAddToChat,
  onAddThreadToChat,
  onToggleCollapsed,
  onResolveThread,
  onOpenThreadInDiff,
  replyController,
  replyContext,
}: TimelineEntryCallbacks & {
  entry: PrThreadEntry;
  collapsed: boolean;
}) {
  return (
    <View style={styles.card} testID="pr-pane-activity-row">
      <ThreadBlock
        thread={entry}
        collapsed={collapsed}
        attachEnabled={attachEnabled}
        brandLabel={brandLabel}
        onAddToChat={onAddToChat}
        onAddThreadToChat={onAddThreadToChat}
        onToggleCollapsed={onToggleCollapsed}
        onResolveThread={onResolveThread}
        onOpenThreadInDiff={onOpenThreadInDiff}
        replyController={replyController}
        replyContext={replyContext}
      />
    </View>
  );
}

function ReviewCard({
  entry,
  collapsed,
  collapsedEntryIds,
  attachEnabled,
  brandLabel,
  onAddToChat,
  onAddThreadToChat,
  onToggleCollapsed,
  onResolveThread,
  onOpenThreadInDiff,
  replyController,
  replyContext,
}: TimelineEntryCallbacks & {
  entry: PrReviewEntry;
  collapsed: boolean;
  collapsedEntryIds: ReadonlySet<string>;
}) {
  const { t } = useTranslation();
  const { review, threads } = entry;
  const { actionsVisible, handlePointerEnter, handlePointerLeave, setMenuOpen } =
    useRevealOnHover();
  const hasBody = review.body.trim() !== "";
  const handleAddToChat = useCallback(() => onAddToChat(review), [onAddToChat, review]);
  const handleHeaderPress = useCallback(() => {
    onToggleCollapsed(entry.id, collapsed);
  }, [collapsed, entry.id, onToggleCollapsed]);
  const handleOpenReview = useCallback(() => {
    void openExternalUrl(review.url);
  }, [review.url]);

  if (isReviewEntryEmpty(entry)) {
    return (
      <View
        style={styles.eventRow}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        testID="pr-pane-activity-row"
      >
        <Pressable onPress={handleOpenReview} style={entryHeaderPressableStyle}>
          <ActivityHeader activity={review} avatarSize={20}>
            <ActivityKebab
              activity={review}
              visible={actionsVisible}
              attachEnabled={attachEnabled}
              brandLabel={brandLabel}
              onMenuOpenChange={setMenuOpen}
              onAddToChat={onAddToChat}
            />
          </ActivityHeader>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={styles.card}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      testID="pr-pane-activity-row"
    >
      <Pressable onPress={handleHeaderPress} style={entryHeaderPressableStyle}>
        <ActivityHeader activity={review} avatarSize={20}>
          {collapsed && attachEnabled && canAddPullRequestActivityToChat(review) ? (
            <Button
              variant="ghost"
              size="xs"
              leftIcon={MessageSquarePlus}
              onPress={handleAddToChat}
              style={styles.checkAddButton}
            >
              {t("workspace.git.pr.actions.addToChat")}
            </Button>
          ) : null}
          {collapsed ? (
            <View style={styles.threadCount}>
              <ThemedMessageSquare size={11} uniProps={foregroundMutedColorMapping} />
              <Text style={styles.ageText}>{threads.length}</Text>
            </View>
          ) : null}
          <ActivityKebab
            activity={review}
            visible={actionsVisible}
            attachEnabled={attachEnabled}
            brandLabel={brandLabel}
            onMenuOpenChange={setMenuOpen}
            onAddToChat={onAddToChat}
          />
        </ActivityHeader>
      </Pressable>
      {collapsed ? null : (
        <>
          {hasBody ? (
            <View style={styles.cardBody}>
              <MarkdownRenderer
                text={review.body}
                compact
                imagePreview
                onLinkPress={handleMarkdownLinkPress}
              />
            </View>
          ) : null}
          {attachEnabled && canAddPullRequestActivityToChat(review) ? (
            <View style={styles.cardFooter}>
              <Button
                variant="ghost"
                size="xs"
                leftIcon={MessageSquarePlus}
                onPress={handleAddToChat}
              >
                {t("workspace.git.pr.actions.addToChat")}
              </Button>
            </View>
          ) : null}
          {threads.length > 0 ? (
            <View style={styles.nestedThreadsContainer}>
              {threads.map((thread) => (
                <View key={thread.id} style={styles.nestedThread}>
                  <ThreadBlock
                    thread={thread}
                    collapsed={collapsedEntryIds.has(thread.id)}
                    attachEnabled={attachEnabled}
                    brandLabel={brandLabel}
                    onAddToChat={onAddToChat}
                    onAddThreadToChat={onAddThreadToChat}
                    onToggleCollapsed={onToggleCollapsed}
                    onResolveThread={onResolveThread}
                    onOpenThreadInDiff={onOpenThreadInDiff}
                    replyController={replyController}
                    replyContext={replyContext}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

function ThreadKebabMenu({
  thread,
  brandLabel,
  visible,
  onMenuOpenChange,
  onResolveThread,
  onOpenThreadInDiff,
}: {
  thread: PrThreadEntry;
  brandLabel: string;
  visible: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onResolveThread?: (thread: PrThreadEntry, resolved: boolean) => void;
  onOpenThreadInDiff?: (thread: PrThreadEntry) => void;
}) {
  const { t } = useTranslation();
  const handleOpenThread = useCallback(() => {
    void openExternalUrl(thread.comments[0].url);
  }, [thread.comments]);
  const handleResolve = useCallback(
    () => onResolveThread?.(thread, !thread.isResolved),
    [onResolveThread, thread],
  );
  const handleOpenInDiff = useCallback(
    () => onOpenThreadInDiff?.(thread),
    [onOpenThreadInDiff, thread],
  );
  const rootThreadId = thread.comments[0]?.location?.threadId ?? thread.comments[0]?.threadId;
  const canResolve = Boolean(onResolveThread) && Boolean(rootThreadId);
  const canOpenInDiff =
    Boolean(onOpenThreadInDiff) &&
    thread.location?.line !== undefined &&
    !thread.location?.isOutdated;

  return (
    <View style={kebabSlotStyle(visible)} pointerEvents={visible ? "auto" : "none"}>
      <DropdownMenu onOpenChange={onMenuOpenChange}>
        <DropdownMenuTrigger
          hitSlop={8}
          style={kebabTriggerStyle}
          accessibilityLabel={t("workspace.git.pr.accessibility.threadActions")}
        >
          {renderKebabTriggerIcon}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={200}>
          {canOpenInDiff ? (
            <DropdownMenuItem leading={OPEN_IN_DIFF_MENU_ICON} onSelect={handleOpenInDiff}>
              {t("workspace.git.pr.actions.openInDiff")}
            </DropdownMenuItem>
          ) : null}
          {canResolve ? (
            <DropdownMenuItem leading={RESOLVE_MENU_ICON} onSelect={handleResolve}>
              {thread.isResolved
                ? t("workspace.git.pr.actions.unresolve")
                : t("workspace.git.pr.actions.resolve")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem leading={OPEN_MENU_ICON} onSelect={handleOpenThread}>
            {t("workspace.git.pr.actions.openOn", { brand: brandLabel })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function ThreadActionsFooter({
  threadId,
  isResolved,
  attachEnabled,
  canResolve,
  replyEnabled,
  replyOpen,
  onReplyOpen,
  onReplyOpenChange,
  onAddToChat,
  onResolve,
  onReplySubmit,
}: {
  threadId: string;
  isResolved: boolean;
  attachEnabled: boolean;
  canResolve: boolean;
  replyEnabled: boolean;
  replyOpen: boolean;
  onReplyOpen: () => void;
  onReplyOpenChange: (open: boolean) => void;
  onAddToChat: () => void;
  onResolve: () => void;
  onReplySubmit: (body: string) => Promise<{ ok: boolean; error: string | null }>;
}) {
  const { t } = useTranslation();
  if (replyOpen && replyEnabled) {
    return (
      <View style={styles.cardFooter}>
        <PrReplyComposer
          open
          onOpenChange={onReplyOpenChange}
          onSubmit={onReplySubmit}
          testID={`pr-thread-reply-${threadId}`}
        />
      </View>
    );
  }
  if (!attachEnabled && !canResolve && !replyEnabled) {
    return null;
  }
  return (
    <View style={styles.cardFooter}>
      {attachEnabled ? (
        <Button variant="ghost" size="xs" leftIcon={MessageSquarePlus} onPress={onAddToChat}>
          {t("workspace.git.pr.actions.addToChat")}
        </Button>
      ) : null}
      {canResolve ? (
        <Button
          variant="ghost"
          size="xs"
          leftIcon={Check}
          onPress={onResolve}
          testID={`pr-thread-resolve-${threadId}`}
        >
          {isResolved
            ? t("workspace.git.pr.actions.unresolve")
            : t("workspace.git.pr.actions.resolve")}
        </Button>
      ) : null}
      {replyEnabled ? (
        <Button
          variant="ghost"
          size="xs"
          leftIcon={Reply}
          onPress={onReplyOpen}
          testID={`pr-thread-reply-${threadId}-open`}
        >
          {t("workspace.git.pr.actions.reply")}
        </Button>
      ) : null}
    </View>
  );
}

function ThreadBlock({
  thread,
  collapsed,
  attachEnabled,
  brandLabel,
  onAddToChat,
  onAddThreadToChat,
  onToggleCollapsed,
  onResolveThread,
  onOpenThreadInDiff,
  replyController,
  replyContext,
}: {
  thread: PrThreadEntry;
  collapsed: boolean;
  attachEnabled: boolean;
  brandLabel: string;
  onAddToChat: (activity: PrPaneActivity) => void;
  onAddThreadToChat: (thread: PrThreadEntry) => void;
  onToggleCollapsed: (entryId: string, collapsed: boolean) => void;
  onResolveThread?: (thread: PrThreadEntry, resolved: boolean) => void;
  onOpenThreadInDiff?: (thread: PrThreadEntry) => void;
  replyController: UseReplyToPrCommentResult;
  replyContext: { prNumber: number; repoOwner?: string; repoName?: string };
}) {
  const { t } = useTranslation();
  const { actionsVisible, handlePointerEnter, handlePointerLeave, setMenuOpen } =
    useRevealOnHover();
  const handleHeaderPress = useCallback(() => {
    onToggleCollapsed(thread.id, collapsed);
  }, [collapsed, onToggleCollapsed, thread.id]);
  const handleAddThreadToChat = useCallback(
    () => onAddThreadToChat(thread),
    [onAddThreadToChat, thread],
  );
  const handleReply = useCallback(
    (body: string) =>
      replyController.reply({ target: buildThreadReplyTarget(thread, replyContext), body }),
    [replyController, replyContext, thread],
  );
  const handleResolveThreadPress = useCallback(
    () => onResolveThread?.(thread, !thread.isResolved),
    [onResolveThread, thread],
  );
  const rootThreadId = thread.comments[0]?.location?.threadId ?? thread.comments[0]?.threadId;
  const canResolve = Boolean(onResolveThread) && Boolean(rootThreadId);
  const [replyOpen, setReplyOpen] = useState(false);
  const handleReplyOpen = useCallback(() => setReplyOpen(true), []);

  const [root, ...replies] = thread.comments;

  return (
    <View onPointerEnter={handlePointerEnter} onPointerLeave={handlePointerLeave}>
      <Pressable onPress={handleHeaderPress} style={threadHeaderPressableStyle}>
        <Text style={styles.threadPath} numberOfLines={1}>
          {thread.location
            ? formatPullRequestThreadPath(thread.location)
            : t("workspace.git.pr.thread.discussion")}
        </Text>
        {thread.isResolved ? (
          <StatusBadge label={t("workspace.git.pr.thread.resolved")} variant="success" />
        ) : null}
        {thread.location?.isOutdated ? (
          <StatusBadge label={t("workspace.git.pr.thread.outdated")} />
        ) : null}
        <View style={styles.headerTrailing}>
          {collapsed ? (
            <View style={styles.threadCount}>
              <ThemedMessageSquare size={11} uniProps={foregroundMutedColorMapping} />
              <Text style={styles.ageText}>{thread.comments.length}</Text>
            </View>
          ) : null}
          <ThreadKebabMenu
            thread={thread}
            brandLabel={brandLabel}
            visible={actionsVisible}
            onMenuOpenChange={setMenuOpen}
            onResolveThread={onResolveThread}
            onOpenThreadInDiff={onOpenThreadInDiff}
          />
        </View>
      </Pressable>
      {collapsed ? null : (
        <>
          <ThreadComment
            comment={root}
            attachEnabled={attachEnabled}
            brandLabel={brandLabel}
            onAddToChat={onAddToChat}
          />
          {replies.length > 0 ? (
            <View style={styles.replyRail}>
              {replies.map((reply) => (
                <View key={reply.id} style={styles.replyCard}>
                  <ThreadComment
                    comment={reply}
                    attachEnabled={attachEnabled}
                    brandLabel={brandLabel}
                    onAddToChat={onAddToChat}
                    contentStyle={styles.replyThreadComment}
                  />
                </View>
              ))}
            </View>
          ) : null}
          <ThreadActionsFooter
            threadId={thread.id}
            isResolved={thread.isResolved === true}
            attachEnabled={attachEnabled}
            canResolve={canResolve}
            replyEnabled={replyController.enabled}
            replyOpen={replyOpen}
            onReplyOpen={handleReplyOpen}
            onReplyOpenChange={setReplyOpen}
            onAddToChat={handleAddThreadToChat}
            onResolve={handleResolveThreadPress}
            onReplySubmit={handleReply}
          />
        </>
      )}
    </View>
  );
}

function threadHeaderPressableStyle({ hovered }: { hovered?: boolean }) {
  return [styles.threadHeader, Boolean(hovered) && styles.hoverable];
}

function threadCommentStyle(contentStyle?: ViewStyle) {
  return contentStyle ? [styles.threadComment, contentStyle] : styles.threadComment;
}

function ThreadComment({
  comment,
  attachEnabled,
  brandLabel,
  onAddToChat,
  contentStyle,
}: {
  comment: PrPaneActivity;
  attachEnabled: boolean;
  brandLabel: string;
  onAddToChat: (activity: PrPaneActivity) => void;
  contentStyle?: ViewStyle;
}) {
  const { actionsVisible, handlePointerEnter, handlePointerLeave, setMenuOpen } =
    useRevealOnHover();
  return (
    <View
      style={threadCommentStyle(contentStyle)}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <View style={styles.threadCommentHeader}>
        <ActivityHeader activity={comment} avatarSize={16}>
          <ActivityKebab
            activity={comment}
            visible={actionsVisible}
            attachEnabled={attachEnabled}
            brandLabel={brandLabel}
            onMenuOpenChange={setMenuOpen}
            onAddToChat={onAddToChat}
          />
        </ActivityHeader>
      </View>
      {comment.body.trim() !== "" ? (
        <View style={styles.threadCommentBody}>
          <MarkdownRenderer
            text={comment.body}
            compact
            imagePreview
            onLinkPress={handleMarkdownLinkPress}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
    minHeight: 0,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  invisible: {
    opacity: 0,
  },
  hoverable: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  header: {
    flexDirection: "column",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[4],
  },
  title: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
    lineHeight: 22,
  },
  titleNumber: {
    color: theme.colors.foregroundMuted,
  },
  metaLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    minHeight: 16,
  },
  stateLabelOpen: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusSuccess,
  },
  stateLabelDraft: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  stateLabelMerged: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusMerged,
  },
  stateLabelClosed: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.statusDanger,
  },
  repoRef: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
    marginLeft: theme.spacing[1],
  },
  headerLinkIcon: {
    marginLeft: theme.spacing[1],
  },
  headerLinkIconHidden: {
    marginLeft: theme.spacing[1],
    opacity: 0,
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
  stackList: {
    flexDirection: "column",
  },
  stackRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  stackNumber: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  stackTitle: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
  },
  stackTitleCurrent: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  stackCurrentBadge: {
    marginLeft: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  stackCurrentBadgeText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingRight: theme.spacing[3],
    paddingLeft: theme.spacing[3],
  },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  viewButton: {
    gap: theme.spacing[1],
    minHeight: 24,
    height: 24,
    paddingVertical: 0,
    paddingHorizontal: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  refreshIcon: {
    width: ICON_SIZE.md,
    height: ICON_SIZE.md,
    alignItems: "center",
    justifyContent: "center",
  },
  checkAddButton: {
    paddingVertical: 0,
  },
  activityToolbar: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 28,
    paddingRight: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  toolbarTrailing: {
    marginLeft: "auto",
  },
  filterTriggerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  filterHiddenCount: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  eventRow: {
    marginHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[2],
  },
  card: {
    marginHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSidebar,
    overflow: "hidden",
  },
  entryHeaderPressable: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    minHeight: 36,
  },
  headerTrailing: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  authorText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  verbGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  verbMuted: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  verbSuccess: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusSuccess,
  },
  verbDanger: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
  },
  ageText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  kebabSlot: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  kebabSlotHidden: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0,
  },
  kebabButton: {
    padding: 2,
    borderRadius: 4,
  },
  kebabButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  cardBody: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[3],
  },
  cardFooter: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingLeft: 0,
    paddingRight: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  nestedThreadsContainer: {
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  nestedThread: {
    marginHorizontal: theme.spacing[3],
    marginBottom: theme.spacing[2],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    overflow: "hidden",
  },
  threadHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    minHeight: 36,
    backgroundColor: theme.colors.surface1,
  },
  threadPath: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  threadCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  threadComment: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingBottom: theme.spacing[2],
  },
  threadCommentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
    minHeight: 32,
  },
  threadCommentBody: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
  },
  replyRail: {
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[2],
  },
  replyCard: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    marginBottom: theme.spacing[2],
    overflow: "hidden",
  },
  replyThreadComment: {
    borderTopWidth: 0,
  },
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: {
    fontSize: 10,
    fontWeight: theme.fontWeight.normal,
    color: "#fff",
  },
}));
