import type { ReviewableDiffTarget } from "@/utils/diff-layout";

// The canvas reserves overlay space by computed height. Comment bodies render
// markdown + image previews (like the activity list), whose height is dynamic, so
// each card reports its measured height (see `commentHeights`) and the reservation
// uses it; this constant is only the pre-measurement fallback.
export const PR_INLINE_COMMENT_HEIGHT = 68;
export const PR_INLINE_EDITOR_HEIGHT = 140;
export const PR_INLINE_REPLY_BUTTON_HEIGHT = 34;
/** Height reserved for the resolved/outdated status badge row when it renders. */
export const PR_INLINE_BADGE_ROW_HEIGHT = 22;
export const PR_INLINE_GAP = 6;
export const PR_INLINE_VERTICAL_PADDING = 8;

export interface PrInlineComment {
  id: string;
  author: string;
  avatarColor: string;
  avatarUrl?: string | null;
  body: string;
  age: string;
}

export interface PrInlineThreadData {
  /** Unique per thread: target key plus the forge thread id. Keys composer state. */
  key: string;
  threadId?: string;
  isResolved: boolean;
  isOutdated: boolean;
  location: { path: string; line?: number };
  comments: PrInlineComment[];
}

export interface PrInlineReplyResult {
  ok: boolean;
  error: string | null;
}

export interface PrInlineActions {
  threadsByTarget: ReadonlyMap<string, PrInlineThreadData[]>;
  /** Number of visible comments per file path, for the changed-files comment badge. */
  commentCountByPath: ReadonlyMap<string, number>;
  /** Thread keys whose reply composer is expanded. */
  openComposerKeys: ReadonlySet<string>;
  onToggleComposer: (threadKey: string, open: boolean) => void;
  onReply: (thread: PrInlineThreadData, body: string) => Promise<PrInlineReplyResult>;
  /** Attaches the whole thread to the workspace chat. Undefined when attach is unavailable. */
  onAddThreadToChat?: (threadKey: string) => void;
  /** Resolves/reopens the thread. Undefined when the daemon can't resolve threads. */
  onResolveThread?: (input: { threadKey: string; resolved: boolean }) => void;
  /** Measured rendered height per comment id; absent entries use the fallback height. */
  commentHeights: ReadonlyMap<string, number>;
  /** Reports a comment's measured height so the canvas reserves the right space. */
  onMeasureCommentHeight: (commentId: string, height: number) => void;
}

function threadBlockHeight(
  thread: PrInlineThreadData,
  open: boolean,
  commentHeights: ReadonlyMap<string, number>,
): number {
  const commentsHeight =
    thread.comments.reduce(
      (total, comment) => total + (commentHeights.get(comment.id) ?? PR_INLINE_COMMENT_HEIGHT),
      0,
    ) +
    Math.max(0, thread.comments.length - 1) * PR_INLINE_GAP;
  const composerHeight = open ? PR_INLINE_EDITOR_HEIGHT : PR_INLINE_REPLY_BUTTON_HEIGHT;
  // The resolved/outdated badge row renders above the comments when present.
  const badgeHeight =
    thread.isResolved || thread.isOutdated ? PR_INLINE_BADGE_ROW_HEIGHT + PR_INLINE_GAP : 0;
  return badgeHeight + commentsHeight + PR_INLINE_GAP + composerHeight;
}

export interface PrInlineThreadState {
  threads: PrInlineThreadData[];
  openComposerKeys: ReadonlySet<string>;
  height: number;
}

export function getPrInlineThreadState(input: {
  reviewTarget: ReviewableDiffTarget | null | undefined;
  prReviewActions?: PrInlineActions;
}): PrInlineThreadState | null {
  const { reviewTarget, prReviewActions } = input;
  if (!reviewTarget || !prReviewActions) return null;
  const threads = prReviewActions.threadsByTarget.get(reviewTarget.key);
  if (!threads || threads.length === 0) return null;
  const height =
    PR_INLINE_VERTICAL_PADDING * 2 +
    threads.reduce(
      (total, thread) =>
        total +
        threadBlockHeight(
          thread,
          prReviewActions.openComposerKeys.has(thread.key),
          prReviewActions.commentHeights,
        ),
      0,
    ) +
    Math.max(0, threads.length - 1) * PR_INLINE_GAP;
  return { threads, openComposerKeys: prReviewActions.openComposerKeys, height };
}

export function getSplitPrInlineThreadState(input: {
  left: ReviewableDiffTarget | null | undefined;
  right: ReviewableDiffTarget | null | undefined;
  prReviewActions?: PrInlineActions;
}): {
  left: PrInlineThreadState | null;
  right: PrInlineThreadState | null;
  height: number;
} | null {
  const left = getPrInlineThreadState({
    reviewTarget: input.left,
    prReviewActions: input.prReviewActions,
  });
  const right = getPrInlineThreadState({
    reviewTarget: input.right,
    prReviewActions: input.prReviewActions,
  });
  const height = Math.max(left?.height ?? 0, right?.height ?? 0);
  return height === 0 ? null : { left, right, height };
}

/**
 * Geometry-affecting PR state: which targets hold threads, how many comments each
 * has, and which composers are open. A change here re-keys the diff model so the
 * reserved row heights are recomputed.
 */
export function prInlineGeometryKey(prReviewActions?: PrInlineActions): string {
  if (!prReviewActions) return "";
  const threads = [...prReviewActions.threadsByTarget.entries()]
    .map(([target, targetThreads]) => [
      target,
      targetThreads
        .map(
          (thread) =>
            `${thread.key}:${thread.comments.length}:${thread.isResolved ? 1 : 0}${
              thread.isOutdated ? 1 : 0
            }`,
        )
        .sort(),
    ])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  const open = [...prReviewActions.openComposerKeys].sort();
  // Measured comment heights change the reserved overlay space, so a change here
  // must re-key the diff model to trigger a repaint at the new height.
  const heights = [...prReviewActions.commentHeights.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify([threads, open, heights]);
}
