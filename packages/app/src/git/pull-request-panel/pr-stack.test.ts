import { describe, expect, it } from "vitest";
import type { ForgeSearchItem } from "@getpaseo/protocol/messages";
import { buildPrStack, type PrStackCurrent } from "./pr-stack";

function cr(input: {
  number: number;
  head: string | null;
  base: string | null;
  state?: string;
}): ForgeSearchItem {
  return {
    kind: "change_request",
    number: input.number,
    title: `PR ${input.number}`,
    url: `https://github.com/o/r/pull/${input.number}`,
    state: input.state ?? "OPEN",
    body: null,
    labels: [],
    baseRefName: input.base,
    headRefName: input.head,
  };
}

function current(input: { number: number; head: string; base: string }): PrStackCurrent {
  return {
    number: input.number,
    title: `PR ${input.number}`,
    url: `https://github.com/o/r/pull/${input.number}`,
    state: "open",
    headRefName: input.head,
    baseRefName: input.base,
  };
}

function numbers(stack: ReturnType<typeof buildPrStack>): number[] {
  return stack.map((entry) => entry.number);
}

describe("buildPrStack", () => {
  it("orders the chain root → tip with the current PR in the middle", () => {
    const stack = buildPrStack({
      current: current({ number: 2, head: "b", base: "a" }),
      openChangeRequests: [
        cr({ number: 3, head: "c", base: "b" }),
        cr({ number: 1, head: "a", base: "main" }),
      ],
    });

    expect(numbers(stack)).toEqual([1, 2, 3]);
    expect(stack.map((entry) => entry.isCurrent)).toEqual([false, true, false]);
  });

  it("walks ancestors when the current PR is the tip", () => {
    const stack = buildPrStack({
      current: current({ number: 3, head: "c", base: "b" }),
      openChangeRequests: [
        cr({ number: 1, head: "a", base: "main" }),
        cr({ number: 2, head: "b", base: "a" }),
      ],
    });

    expect(numbers(stack)).toEqual([1, 2, 3]);
    expect(stack[2].isCurrent).toBe(true);
  });

  it("walks descendants when the current PR is the root", () => {
    const stack = buildPrStack({
      current: current({ number: 1, head: "a", base: "main" }),
      openChangeRequests: [
        cr({ number: 2, head: "b", base: "a" }),
        cr({ number: 3, head: "c", base: "b" }),
      ],
    });

    expect(numbers(stack)).toEqual([1, 2, 3]);
    expect(stack[0].isCurrent).toBe(true);
  });

  it("returns a single entry when the PR is not part of a stack", () => {
    const stack = buildPrStack({
      current: current({ number: 1, head: "a", base: "main" }),
      openChangeRequests: [cr({ number: 9, head: "x", base: "main" })],
    });

    expect(numbers(stack)).toEqual([1]);
    expect(stack[0].isCurrent).toBe(true);
  });

  it("ignores the current PR echoed back in the open list", () => {
    const stack = buildPrStack({
      current: current({ number: 2, head: "b", base: "a" }),
      openChangeRequests: [
        cr({ number: 2, head: "b", base: "a" }),
        cr({ number: 1, head: "a", base: "main" }),
      ],
    });

    expect(numbers(stack)).toEqual([1, 2]);
  });

  it("skips PRs missing a head or base ref", () => {
    const stack = buildPrStack({
      current: current({ number: 2, head: "b", base: "a" }),
      openChangeRequests: [
        cr({ number: 1, head: null, base: "main" }),
        cr({ number: 3, head: "c", base: null }),
      ],
    });

    expect(numbers(stack)).toEqual([2]);
  });

  it("includes every child when a branch is stacked on by several PRs", () => {
    const stack = buildPrStack({
      current: current({ number: 1, head: "a", base: "main" }),
      openChangeRequests: [
        cr({ number: 3, head: "c", base: "a" }),
        cr({ number: 2, head: "b", base: "a" }),
      ],
    });

    // Breadth-first, siblings ordered by number for determinism.
    expect(numbers(stack)).toEqual([1, 2, 3]);
  });

  it("terminates and does not duplicate PRs when the chain cycles", () => {
    const stack = buildPrStack({
      current: current({ number: 1, head: "a", base: "b" }),
      openChangeRequests: [cr({ number: 2, head: "b", base: "a" })],
    });

    expect(numbers(stack).sort()).toEqual([1, 2]);
    expect(new Set(numbers(stack)).size).toBe(2);
  });

  it("maps the forge state string onto the neutral PR state", () => {
    const stack = buildPrStack({
      current: current({ number: 2, head: "b", base: "a" }),
      openChangeRequests: [cr({ number: 1, head: "a", base: "main", state: "MERGED" })],
    });

    expect(stack[0].state).toBe("merged");
  });

  it("keeps the first PR when two share a head branch", () => {
    const stack = buildPrStack({
      current: current({ number: 9, head: "tip", base: "shared" }),
      openChangeRequests: [
        cr({ number: 5, head: "shared", base: "main" }),
        cr({ number: 6, head: "shared", base: "main" }),
      ],
    });

    expect(numbers(stack)).toEqual([5, 9]);
  });
});
