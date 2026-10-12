import type { ForgeSearchItem } from "@getpaseo/protocol/messages";
import type { PrState } from "./data";

/** The current workspace's PR, anchoring the stack it belongs to. */
export interface PrStackCurrent {
  number: number;
  title: string;
  state: PrState;
  url: string;
  headRefName: string;
  baseRefName: string;
}

/** One PR in the stack, ordered from the stack root (base) to the tip (head). */
export interface PrStackEntry {
  number: number;
  title: string;
  state: PrState;
  url: string;
  headRefName: string;
  baseRefName: string;
  isCurrent: boolean;
}

export interface BuildPrStackInput {
  current: PrStackCurrent;
  /** Open change requests for the repo, as returned by forge search. */
  openChangeRequests: ForgeSearchItem[];
}

interface NormalizedPr {
  number: number;
  title: string;
  state: PrState;
  url: string;
  headRefName: string;
  baseRefName: string;
}

/**
 * Assembles the stack the current PR belongs to: the chain of open PRs where each
 * PR's base branch is the previous PR's head branch. Walks ancestors up from the
 * current PR's base to the root, and descendants (breadth-first) down from its head.
 * Returns the chain ordered root → tip; a lone PR with no stack yields one entry.
 */
export function buildPrStack({ current, openChangeRequests }: BuildPrStackInput): PrStackEntry[] {
  const byHead = new Map<string, NormalizedPr>();
  const childrenByBase = new Map<string, NormalizedPr[]>();

  for (const item of openChangeRequests) {
    if (item.kind !== "change_request" || item.number === current.number) {
      continue;
    }
    const headRefName = normalizeRef(item.headRefName);
    const baseRefName = normalizeRef(item.baseRefName);
    if (!headRefName || !baseRefName) {
      continue;
    }
    const pr: NormalizedPr = {
      number: item.number,
      title: item.title,
      state: toPrState(item.state),
      url: item.url,
      headRefName,
      baseRefName,
    };
    if (!byHead.has(headRefName)) {
      byHead.set(headRefName, pr);
    }
    const siblings = childrenByBase.get(baseRefName);
    if (siblings) {
      siblings.push(pr);
    } else {
      childrenByBase.set(baseRefName, [pr]);
    }
  }

  // Seed with the current PR so a cycle (A→B→A) can never re-add it or loop forever.
  const visited = new Set<number>([current.number]);

  const ancestors: NormalizedPr[] = [];
  let base = normalizeRef(current.baseRefName);
  while (base) {
    const parent = byHead.get(base);
    if (!parent || visited.has(parent.number)) {
      break;
    }
    visited.add(parent.number);
    ancestors.push(parent);
    base = parent.baseRefName;
  }
  ancestors.reverse();

  const descendants: NormalizedPr[] = [];
  const head = normalizeRef(current.headRefName);
  const queue = head ? sortByNumber(childrenByBase.get(head) ?? []) : [];
  while (queue.length > 0) {
    const child = queue.shift();
    if (!child || visited.has(child.number)) {
      continue;
    }
    visited.add(child.number);
    descendants.push(child);
    queue.push(...sortByNumber(childrenByBase.get(child.headRefName) ?? []));
  }

  return [...ancestors.map(toEntry), { ...current, isCurrent: true }, ...descendants.map(toEntry)];
}

function normalizeRef(ref: string | null | undefined): string | null {
  if (typeof ref !== "string") {
    return null;
  }
  const trimmed = ref.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toPrState(state: string): PrState {
  switch (state.toLowerCase()) {
    case "merged":
      return "merged";
    case "closed":
      return "closed";
    case "draft":
      return "draft";
    default:
      return "open";
  }
}

function sortByNumber(prs: NormalizedPr[]): NormalizedPr[] {
  return [...prs].sort((left, right) => left.number - right.number);
}

function toEntry(pr: NormalizedPr): PrStackEntry {
  return { ...pr, isCurrent: false };
}
