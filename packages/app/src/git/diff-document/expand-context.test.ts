import { describe, expect, it } from "vitest";
import type { ParsedDiffFile } from "@getpaseo/protocol/messages";
import {
  computeExpandableGaps,
  mergeRevealedAbove,
  mergeRevealedBelow,
  resolveExpandRequest,
} from "./expand-context";

function file(): ParsedDiffFile {
  return {
    path: "a.ts",
    isNew: false,
    isDeleted: false,
    additions: 1,
    deletions: 0,
    hunks: [
      {
        oldStart: 10,
        oldCount: 2,
        newStart: 10,
        newCount: 3,
        lines: [
          { type: "header", content: "@@ -10,2 +10,3 @@" },
          { type: "context", content: "ten" },
          { type: "add", content: "new" },
          { type: "context", content: "eleven" },
        ],
      },
      {
        oldStart: 30,
        oldCount: 1,
        newStart: 31,
        newCount: 1,
        lines: [
          { type: "header", content: "@@ -30,1 +31,1 @@" },
          { type: "context", content: "thirty" },
        ],
      },
    ],
  };
}

describe("computeExpandableGaps", () => {
  it("finds the head gap and the between-hunk gap", () => {
    const gaps = computeExpandableGaps(file());
    expect(gaps).toEqual([
      { hunkIndex: 0, aboveHunkIndex: null, oldStart: 1, oldEnd: 9, size: 9 },
      { hunkIndex: 1, aboveHunkIndex: 0, oldStart: 12, oldEnd: 29, size: 18 },
    ]);
  });

  it("omits adjacent hunks with no gap", () => {
    const f = file();
    f.hunks[1]!.oldStart = 12;
    f.hunks[1]!.newStart = 13;
    const gaps = computeExpandableGaps(f);
    expect(gaps.map((gap) => gap.hunkIndex)).toEqual([0]);
  });
});

describe("resolveExpandRequest", () => {
  const [, between] = computeExpandableGaps(file());

  it("reveals the bottom of the gap for 'up' (clamped to the gap start)", () => {
    // The gap (12..29) is smaller than the chunk, so 'up' reveals all of it.
    expect(resolveExpandRequest(between!, "up")).toEqual({
      oldStart: 12,
      oldEnd: 29,
      merge: "above",
      hunkIndex: 1,
    });
  });

  it("reveals only a chunk from the bottom for a large gap", () => {
    const big = { hunkIndex: 1, aboveHunkIndex: 0, oldStart: 1, oldEnd: 100, size: 100 } as const;
    expect(resolveExpandRequest(big, "up")).toEqual({
      oldStart: 81,
      oldEnd: 100,
      merge: "above",
      hunkIndex: 1,
    });
  });

  it("reveals the top of the gap into the hunk above for 'down'", () => {
    expect(resolveExpandRequest(between!, "down")).toEqual({
      oldStart: 12,
      oldEnd: 29,
      merge: "below",
      hunkIndex: 0,
    });
  });

  it("returns null for 'down' at the head gap", () => {
    const [head] = computeExpandableGaps(file());
    expect(resolveExpandRequest(head!, "down")).toBeNull();
  });
});

describe("mergeRevealedAbove", () => {
  it("prepends context, shifts the hunk start, and rewrites the header", () => {
    const merged = mergeRevealedAbove(file(), 1, ["twenty-nine"]);
    const hunk = merged.hunks[1]!;
    expect(hunk.oldStart).toBe(29);
    expect(hunk.newStart).toBe(30);
    expect(hunk.oldCount).toBe(2);
    expect(hunk.newCount).toBe(2);
    expect(hunk.lines[0]).toEqual({ type: "header", content: "@@ -29,2 +30,2 @@" });
    expect(hunk.lines[1]).toEqual({ type: "context", content: "twenty-nine" });
    // The original file is untouched.
    expect(file().hunks[1]!.oldStart).toBe(30);
  });
});

describe("mergeRevealedBelow", () => {
  it("appends context and grows the counts", () => {
    const merged = mergeRevealedBelow(file(), 0, ["twelve", "thirteen"]);
    const hunk = merged.hunks[0]!;
    expect(hunk.oldCount).toBe(4);
    expect(hunk.newCount).toBe(5);
    expect(hunk.lines.at(-1)).toEqual({ type: "context", content: "thirteen" });
    expect(hunk.lines[0]).toEqual({ type: "header", content: "@@ -10,4 +10,5 @@" });
  });
});
