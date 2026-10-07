import type { ReviewableDiffTarget } from "@/utils/diff-layout";

// Fixed row heights, mirroring the local review-draft overlay: the canvas reserves
// space by computed height (it never measures the rendered DOM), so each piece has a
// known size and comment bodies are truncated to fit. Full text stays in the list.
export const PR_INLINE_COMMENT_HEIGHT = 68;
export const PR_INLINE_EDITOR_HEIGHT = 140;
export const PR_INLINE_REPLY_BUTTON_HEIGHT = 34;
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
  /** Thread keys whose reply composer is expanded. */
  openComposerKeys: ReadonlySet<string>;
  onToggleComposer: (threadKey: string, open: boolean) => void;
  onReply: (thread: PrInlineThreadData, body: string) => Promise<PrInlineReplyResult>;
}

function threadBlockHeight(thread: PrInlineThreadData, open: boolean): number {
  const commentsHeight =
    thread.comments.length * PR_INLINE_COMMENT_HEIGHT +
    Math.max(0, thread.comments.length - 1) * PR_INLINE_GAP;
  const composerHeight = open ? PR_INLINE_EDITOR_HEIGHT : PR_INLINE_REPLY_BUTTON_HEIGHT;
  return commentsHeight + PR_INLINE_GAP + composerHeight;
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
        total + threadBlockHeight(thread, prReviewActions.openComposerKeys.has(thread.key)),
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
      targetThreads.map((thread) => `${thread.key}:${thread.comments.length}`).sort(),
    ])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  const open = [...prReviewActions.openComposerKeys].sort();
  return JSON.stringify([threads, open]);
}
