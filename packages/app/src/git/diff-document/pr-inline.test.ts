import { describe, expect, it } from "vitest";
import type { ReviewableDiffTarget } from "@/utils/diff-layout";
import {
  PR_INLINE_COMMENT_HEIGHT,
  PR_INLINE_EDITOR_HEIGHT,
  PR_INLINE_GAP,
  PR_INLINE_REPLY_BUTTON_HEIGHT,
  PR_INLINE_VERTICAL_PADDING,
  type PrInlineActions,
  type PrInlineThreadData,
  getPrInlineThreadState,
  prInlineGeometryKey,
} from "./pr-inline";

function target(key: string): ReviewableDiffTarget {
  return { key } as ReviewableDiffTarget;
}

function thread(key: string, commentCount: number): PrInlineThreadData {
  return {
    key,
    threadId: key,
    isResolved: false,
    isOutdated: false,
    location: { path: "a.ts", line: 1 },
    comments: Array.from({ length: commentCount }, (_, index) => ({
      id: `${key}-${index}`,
      author: "octocat",
      avatarColor: "#fff",
      body: "looks good",
      age: "1h ago",
    })),
  };
}

function actions(
  threads: PrInlineThreadData[],
  openComposerKeys: string[] = [],
  commentHeights: ReadonlyMap<string, number> = new Map(),
): PrInlineActions {
  return {
    threadsByTarget: new Map([["a.ts:new:1", threads]]),
    commentCountByPath: new Map(),
    openComposerKeys: new Set(openComposerKeys),
    onToggleComposer: () => {},
    onReply: async () => ({ ok: true, error: null }),
    commentHeights,
    onMeasureCommentHeight: () => {},
  };
}

describe("getPrInlineThreadState", () => {
  it("returns null without a target or actions", () => {
    expect(getPrInlineThreadState({ reviewTarget: null, prReviewActions: undefined })).toBeNull();
    expect(
      getPrInlineThreadState({ reviewTarget: target("a.ts:new:1"), prReviewActions: undefined }),
    ).toBeNull();
  });

  it("returns null when the target has no threads", () => {
    expect(
      getPrInlineThreadState({
        reviewTarget: target("b.ts:new:9"),
        prReviewActions: actions([thread("a.ts:new:1#t", 1)]),
      }),
    ).toBeNull();
  });

  it("reserves a reply-button row when the composer is closed", () => {
    const state = getPrInlineThreadState({
      reviewTarget: target("a.ts:new:1"),
      prReviewActions: actions([thread("a.ts:new:1#t", 1)]),
    });
    expect(state?.height).toBe(
      PR_INLINE_VERTICAL_PADDING * 2 +
        PR_INLINE_COMMENT_HEIGHT +
        PR_INLINE_GAP +
        PR_INLINE_REPLY_BUTTON_HEIGHT,
    );
  });

  it("grows to the editor height when the composer is open", () => {
    const state = getPrInlineThreadState({
      reviewTarget: target("a.ts:new:1"),
      prReviewActions: actions([thread("a.ts:new:1#t", 1)], ["a.ts:new:1#t"]),
    });
    expect(state?.height).toBe(
      PR_INLINE_VERTICAL_PADDING * 2 +
        PR_INLINE_COMMENT_HEIGHT +
        PR_INLINE_GAP +
        PR_INLINE_EDITOR_HEIGHT,
    );
  });

  it("stacks multiple comments with gaps", () => {
    const state = getPrInlineThreadState({
      reviewTarget: target("a.ts:new:1"),
      prReviewActions: actions([thread("a.ts:new:1#t", 3)]),
    });
    expect(state?.height).toBe(
      PR_INLINE_VERTICAL_PADDING * 2 +
        3 * PR_INLINE_COMMENT_HEIGHT +
        2 * PR_INLINE_GAP +
        PR_INLINE_GAP +
        PR_INLINE_REPLY_BUTTON_HEIGHT,
    );
  });

  it("uses a measured comment height when reported", () => {
    const state = getPrInlineThreadState({
      reviewTarget: target("a.ts:new:1"),
      prReviewActions: actions([thread("a.ts:new:1#t", 1)], [], new Map([["a.ts:new:1#t-0", 123]])),
    });
    expect(state?.height).toBe(
      PR_INLINE_VERTICAL_PADDING * 2 + 123 + PR_INLINE_GAP + PR_INLINE_REPLY_BUTTON_HEIGHT,
    );
  });
});

describe("prInlineGeometryKey", () => {
  it("is empty without actions", () => {
    expect(prInlineGeometryKey(undefined)).toBe("");
  });

  it("changes when a composer opens so the model re-measures", () => {
    const threads = [thread("a.ts:new:1#t", 1)];
    const closed = prInlineGeometryKey(actions(threads));
    const open = prInlineGeometryKey(actions(threads, ["a.ts:new:1#t"]));
    expect(open).not.toBe(closed);
  });

  it("changes when a thread gains a comment", () => {
    const before = prInlineGeometryKey(actions([thread("a.ts:new:1#t", 1)]));
    const after = prInlineGeometryKey(actions([thread("a.ts:new:1#t", 2)]));
    expect(after).not.toBe(before);
  });

  it("changes when a measured comment height changes so the model repaints", () => {
    const threads = [thread("a.ts:new:1#t", 1)];
    const before = prInlineGeometryKey(actions(threads));
    const after = prInlineGeometryKey(actions(threads, [], new Map([["a.ts:new:1#t-0", 140]])));
    expect(after).not.toBe(before);
  });
});
