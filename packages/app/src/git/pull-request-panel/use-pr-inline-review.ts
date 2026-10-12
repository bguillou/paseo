import { useCallback, useMemo, useState } from "react";
import {
  buildWorkspaceAttachmentScopeKey,
  useWorkspaceAttachmentsStore,
} from "@/attachments/workspace-attachments-store";
import type { PrInlineActions, PrInlineThreadData } from "@/git/diff-document/pr-inline";
import { usePrPaneData } from "./use-data";
import { buildInlineReviewData } from "./inline-review-data";
import { buildPullRequestThreadContextAttachment } from "./context-attachment";
import { useReplyToPrComment } from "./use-reply-to-comment";
import { useResolvePrThread } from "./use-resolve-thread";
import { usePrShowResolved } from "./pr-review-view-store";

/**
 * Builds the inline PR-thread overlay actions for the diff. Returns undefined when
 * the daemon can't post replies or when disabled (non-base diff), so the diff never
 * shows a reply affordance it can't fulfil. Resolve ships with reply (same daemon
 * version), so both affordances gate together.
 */
export function usePrInlineReview({
  serverId,
  workspaceId,
  cwd,
  enabled,
}: {
  serverId: string;
  workspaceId?: string | null;
  cwd: string;
  enabled: boolean;
}): PrInlineActions | undefined {
  const { data } = usePrPaneData({ serverId, cwd, enabled, timelineEnabled: enabled });
  const replyController = useReplyToPrComment({ serverId, cwd });
  const resolveController = useResolvePrThread({ serverId, cwd });
  const showResolved = usePrShowResolved(serverId, cwd);
  const addWorkspaceAttachment = useWorkspaceAttachmentsStore(
    (state) => state.addWorkspaceAttachment,
  );
  const [openComposerKeys, setOpenComposerKeys] = useState<ReadonlySet<string>>(() => new Set());

  const { threadsByTarget, commentCountByPath, threadsByKey } = useMemo(
    () => buildInlineReviewData(data, showResolved),
    [data, showResolved],
  );

  const onToggleComposer = useCallback((threadKey: string, open: boolean) => {
    setOpenComposerKeys((previous) => {
      const next = new Set(previous);
      if (open) {
        next.add(threadKey);
      } else {
        next.delete(threadKey);
      }
      return next;
    });
  }, []);

  const prNumber = data?.number ?? null;
  const repoOwner = data?.repoOwner;
  const repoName = data?.repoName;
  const onReply = useCallback(
    (thread: PrInlineThreadData, body: string) => {
      if (prNumber === null) {
        return Promise.resolve({ ok: false, error: null });
      }
      return replyController.reply({
        target: {
          prNumber,
          ...(repoOwner ? { repoOwner } : {}),
          ...(repoName ? { repoName } : {}),
          ...(thread.threadId ? { threadId: thread.threadId } : {}),
          location: thread.location,
        },
        body,
      });
    },
    [prNumber, repoName, repoOwner, replyController],
  );

  const scopeKey = useMemo(
    () => buildWorkspaceAttachmentScopeKey({ serverId, workspaceId, cwd }),
    [serverId, workspaceId, cwd],
  );
  const onAddThreadToChat = useCallback(
    (threadKey: string) => {
      const thread = threadsByKey.get(threadKey);
      if (!data || !thread) {
        return;
      }
      const attachment = buildPullRequestThreadContextAttachment({
        provider: data.provider,
        forge: data.forge,
        pullRequest: { number: data.number, title: data.title, url: data.url },
        thread,
      });
      if (attachment) {
        addWorkspaceAttachment({ scopeKey, attachment });
      }
    },
    [addWorkspaceAttachment, data, scopeKey, threadsByKey],
  );

  const onResolveThread = useCallback(
    ({ threadKey, resolved }: { threadKey: string; resolved: boolean }) => {
      const thread = threadsByKey.get(threadKey);
      if (prNumber === null || !thread) {
        return;
      }
      const root = thread.comments[0];
      const threadId = root?.location?.threadId ?? root?.threadId;
      if (!threadId) {
        return;
      }
      void resolveController.setResolved({
        prNumber,
        threadId,
        resolved,
        ...(repoOwner ? { repoOwner } : {}),
        ...(repoName ? { repoName } : {}),
      });
    },
    [prNumber, repoName, repoOwner, resolveController, threadsByKey],
  );

  return useMemo(() => {
    if (!enabled || !replyController.enabled) {
      return undefined;
    }
    return {
      threadsByTarget,
      commentCountByPath,
      openComposerKeys,
      onToggleComposer,
      onReply,
      onAddThreadToChat,
      ...(resolveController.enabled ? { onResolveThread } : {}),
    };
  }, [
    commentCountByPath,
    enabled,
    onAddThreadToChat,
    onReply,
    onResolveThread,
    onToggleComposer,
    openComposerKeys,
    replyController.enabled,
    resolveController.enabled,
    threadsByTarget,
  ]);
}
