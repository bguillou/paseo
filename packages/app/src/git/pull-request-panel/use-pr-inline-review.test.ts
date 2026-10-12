import { describe, expect, it } from "vitest";
import type { PrPaneActivity, PrPaneData } from "./data";
import { buildInlineReviewData } from "./inline-review-data";

function targets(data: PrPaneData | null, showResolved = false) {
  return buildInlineReviewData(data, showResolved).threadsByTarget;
}

function paneData(activity: PrPaneActivity[]): PrPaneData {
  return {
    provider: { id: "github", label: "GitHub" },
    forge: "github",
    number: 42,
    title: "Add feature",
    state: "open",
    url: "https://github.com/o/r/pull/42",
    headRefName: "feature/add",
    baseRefName: "main",
    reviewDecision: "pending",
    awaitingReviewers: [],
    reviewers: [],
    checks: [],
    activity,
  };
}

function fileComment(
  id: string,
  threadId: string,
  line: number,
  overrides: Partial<PrPaneActivity["location"]> = {},
): PrPaneActivity {
  return {
    provider: "github",
    id,
    kind: "comment",
    author: "octocat",
    avatarColor: "#fff",
    body: `comment ${id}`,
    age: "1h ago",
    url: `https://github.com/o/r/pull/42#${id}`,
    location: { path: "src/a.ts", line, threadId, ...overrides },
  };
}

describe("buildInlineReviewData", () => {
  it("returns an empty map without data", () => {
    expect(targets(null).size).toBe(0);
  });

  it("keys a file thread by path:new:line and keeps every comment", () => {
    const map = targets(paneData([fileComment("c1", "t1", 5), fileComment("c2", "t1", 5)]));
    const threads = map.get("src/a.ts:new:5");
    expect(threads).toHaveLength(1);
    expect(threads?.[0]?.comments.map((comment) => comment.id)).toEqual(["c1", "c2"]);
    expect(threads?.[0]?.threadId).toBe("t1");
  });

  it("drops outdated threads so they never anchor to a stale line", () => {
    const map = targets(paneData([fileComment("c1", "t1", 5, { isOutdated: true })]));
    expect(map.size).toBe(0);
  });

  it("drops general comments that carry no file line", () => {
    const general: PrPaneActivity = {
      provider: "github",
      id: "g1",
      kind: "comment",
      author: "octocat",
      avatarColor: "#fff",
      body: "general",
      age: "2h ago",
      url: "https://github.com/o/r/pull/42#g1",
      threadId: "d1",
    };
    expect(targets(paneData([general])).size).toBe(0);
  });

  it("hides resolved threads by default and reveals them when showResolved is set", () => {
    const data = paneData([fileComment("c1", "t1", 5, { isResolved: true })]);
    expect(targets(data).size).toBe(0);
    expect(targets(data, true).get("src/a.ts:new:5")).toHaveLength(1);
  });

  it("counts visible comments per file path", () => {
    const { commentCountByPath } = buildInlineReviewData(
      paneData([
        fileComment("c1", "t1", 5),
        fileComment("c2", "t1", 5),
        fileComment("c3", "t2", 9, { isResolved: true }),
      ]),
      false,
    );
    expect(commentCountByPath.get("src/a.ts")).toBe(2);
  });
});
