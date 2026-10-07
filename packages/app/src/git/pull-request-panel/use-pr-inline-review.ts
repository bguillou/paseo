import { useCallback, useMemo, useState } from "react";
import { buildReviewableDiffTargetKey } from "@/utils/diff-layout";
import type { PrInlineActions, PrInlineThreadData } from "@/git/diff-document/pr-inline";
import { usePrPaneData } from "./use-data";
import { buildPrTimeline, type PrThreadEntry, type PrTimelineEntry } from "./timeline";
import type { PrPaneData } from "./data";
import { useReplyToPrComment } from "./use-reply-to-comment";

function collectThreadEntries(entries: readonly PrTimelineEntry[]): PrThreadEntry[] {
  return entries.flatMap((entry) => {
    if (entry.kind === "thread") {
      return [entry];
    }
    if (entry.kind === "review") {
      return entry.threads;
    }
    return [];
  });
}

/**
 * Maps the PR timeline to diff-anchored threads, keyed by `${path}:new:${line}` to
 * line up with ReviewableDiffTarget. Threads without a file line, and outdated ones
 * (whose line no longer matches the diff), are dropped — they stay in the list.
 */
export function buildThreadsByTarget(data: PrPaneData | null): Map<string, PrInlineThreadData[]> {
  const byTarget = new Map<string, PrInlineThreadData[]>();
  if (!data) {
    return byTarget;
  }
  const threads = collectThreadEntries(buildPrTimeline(data.activity));
  for (const thread of threads) {
    const location = thread.location;
    if (!location || location.line === undefined || location.isOutdated) {
      continue;
    }
    const targetKey = buildReviewableDiffTargetKey({
      filePath: location.path,
      side: "new",
      lineNumber: location.line,
    });
    const root = thread.comments[0];
    const threadId = root?.location?.threadId ?? root?.threadId;
    const inlineThread: PrInlineThreadData = {
      key: `${targetKey}#${threadId ?? thread.id}`,
      ...(threadId ? { threadId } : {}),
      isResolved: thread.isResolved ?? false,
      isOutdated: location.isOutdated ?? false,
      location: { path: location.path, line: location.line },
      comments: thread.comments.map((comment) => ({
        id: comment.id,
        author: comment.author,
        avatarColor: comment.avatarColor,
        avatarUrl: comment.avatarUrl,
        body: comment.body,
        age: comment.age,
      })),
    };
    byTarget.set(targetKey, [...(byTarget.get(targetKey) ?? []), inlineThread]);
  }
  return byTarget;
}

/**
 * Builds the inline PR-thread overlay actions for the diff. Returns undefined when
 * the daemon can't post replies or when disabled (non-base diff), so the diff never
 * shows a reply affordance it can't fulfil.
 */
export function usePrInlineReview({
  serverId,
  cwd,
  enabled,
}: {
  serverId: string;
  cwd: string;
  enabled: boolean;
}): PrInlineActions | undefined {
  const { data } = usePrPaneData({ serverId, cwd, enabled, timelineEnabled: enabled });
  const replyController = useReplyToPrComment({ serverId, cwd });
  const [openComposerKeys, setOpenComposerKeys] = useState<ReadonlySet<string>>(() => new Set());

  const threadsByTarget = useMemo(() => buildThreadsByTarget(data), [data]);

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

  return useMemo(() => {
    if (!enabled || !replyController.enabled) {
      return undefined;
    }
    return { threadsByTarget, openComposerKeys, onToggleComposer, onReply };
  }, [
    enabled,
    onReply,
    onToggleComposer,
    openComposerKeys,
    replyController.enabled,
    threadsByTarget,
  ]);
}
