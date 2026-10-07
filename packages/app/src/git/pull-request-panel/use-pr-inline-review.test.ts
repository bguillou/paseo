import { describe, expect, it } from "vitest";
import type { PrPaneActivity, PrPaneData } from "./data";
import { buildThreadsByTarget } from "./use-pr-inline-review";

function paneData(activity: PrPaneActivity[]): PrPaneData {
  return {
    provider: { id: "github", label: "GitHub" },
    forge: "github",
    number: 42,
    title: "Add feature",
    state: "open",
    url: "https://github.com/o/r/pull/42",
    reviewDecision: "pending",
    awaitingReviewers: [],
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

describe("buildThreadsByTarget", () => {
  it("returns an empty map without data", () => {
    expect(buildThreadsByTarget(null).size).toBe(0);
  });

  it("keys a file thread by path:new:line and keeps every comment", () => {
    const map = buildThreadsByTarget(
      paneData([fileComment("c1", "t1", 5), fileComment("c2", "t1", 5)]),
    );
    const threads = map.get("src/a.ts:new:5");
    expect(threads).toHaveLength(1);
    expect(threads?.[0]?.comments.map((comment) => comment.id)).toEqual(["c1", "c2"]);
    expect(threads?.[0]?.threadId).toBe("t1");
  });

  it("drops outdated threads so they never anchor to a stale line", () => {
    const map = buildThreadsByTarget(paneData([fileComment("c1", "t1", 5, { isOutdated: true })]));
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
    expect(buildThreadsByTarget(paneData([general])).size).toBe(0);
  });
});
