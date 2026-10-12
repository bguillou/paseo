import { buildReviewableDiffTargetKey } from "@/utils/diff-layout";
import type { PrInlineThreadData } from "@/git/diff-document/pr-inline";
import { buildPrTimeline, type PrThreadEntry, type PrTimelineEntry } from "./timeline";
import type { PrPaneData } from "./data";

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

export interface InlineReviewData {
  threadsByTarget: Map<string, PrInlineThreadData[]>;
  /** Visible comment count per file path, matching what renders inline. */
  commentCountByPath: Map<string, number>;
  /** Inline thread key -> source timeline thread, for add-to-chat and resolve. */
  threadsByKey: Map<string, PrThreadEntry>;
}

/**
 * Maps the PR timeline to diff-anchored threads, keyed by `${path}:new:${line}` to
 * line up with ReviewableDiffTarget. Threads without a file line, and outdated ones
 * (whose line no longer matches the diff), are dropped — they stay in the list.
 * Resolved threads are hidden unless `showResolved` reveals them.
 */
export function buildInlineReviewData(
  data: PrPaneData | null,
  showResolved: boolean,
): InlineReviewData {
  const threadsByTarget = new Map<string, PrInlineThreadData[]>();
  const commentCountByPath = new Map<string, number>();
  const threadsByKey = new Map<string, PrThreadEntry>();
  if (!data) {
    return { threadsByTarget, commentCountByPath, threadsByKey };
  }
  const threads = collectThreadEntries(buildPrTimeline(data.activity));
  for (const thread of threads) {
    const location = thread.location;
    if (!location || location.line === undefined || location.isOutdated) {
      continue;
    }
    const isResolved = thread.isResolved ?? false;
    if (isResolved && !showResolved) {
      continue;
    }
    const targetKey = buildReviewableDiffTargetKey({
      filePath: location.path,
      side: "new",
      lineNumber: location.line,
    });
    const root = thread.comments[0];
    const threadId = root?.location?.threadId ?? root?.threadId;
    const key = `${targetKey}#${threadId ?? thread.id}`;
    const inlineThread: PrInlineThreadData = {
      key,
      ...(threadId ? { threadId } : {}),
      isResolved,
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
    threadsByTarget.set(targetKey, [...(threadsByTarget.get(targetKey) ?? []), inlineThread]);
    threadsByKey.set(key, thread);
    commentCountByPath.set(
      location.path,
      (commentCountByPath.get(location.path) ?? 0) + inlineThread.comments.length,
    );
  }
  return { threadsByTarget, commentCountByPath, threadsByKey };
}
