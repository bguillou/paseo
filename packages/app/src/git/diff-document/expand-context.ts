import type { ParsedDiffFile } from "@/git/use-diff-query";

/** Lines revealed per expand click, matching GitHub's chunk size. */
export const EXPAND_CONTEXT_CHUNK = 20;

type Hunk = ParsedDiffFile["hunks"][number];
type HunkLine = Hunk["lines"][number];

/** A hidden (unchanged) region between hunks that can be revealed. */
export interface DiffContextGap {
  /** The hunk below the gap; its header row carries the expand control. */
  hunkIndex: number;
  /** The hunk above the gap, or null when the gap is the file head. */
  aboveHunkIndex: number | null;
  /** 1-based inclusive OLD-side line range of the hidden region. */
  oldStart: number;
  oldEnd: number;
  /** Number of hidden lines. */
  size: number;
}

function hunkHeaderIndex(hunk: Hunk): number {
  return hunk.lines.findIndex((line) => line.type === "header");
}

function formatHunkHeader(hunk: Hunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
}

function contextLine(content: string): HunkLine {
  return { type: "context", content };
}

function cloneHunk(hunk: Hunk): Hunk {
  return { ...hunk, lines: [...hunk.lines] };
}

/**
 * Hidden regions above each hunk (head gap + between-hunk gaps). The tail region
 * after the last hunk is omitted because its size needs the file length.
 */
export function computeExpandableGaps(file: ParsedDiffFile): DiffContextGap[] {
  const gaps: DiffContextGap[] = [];
  for (let index = 0; index < file.hunks.length; index++) {
    const hunk = file.hunks[index]!;
    const previous = index === 0 ? null : file.hunks[index - 1]!;
    const oldStart = previous ? previous.oldStart + previous.oldCount : 1;
    const oldEnd = hunk.oldStart - 1;
    const size = oldEnd - oldStart + 1;
    if (size <= 0) {
      continue;
    }
    gaps.push({
      hunkIndex: index,
      aboveHunkIndex: previous ? index - 1 : null,
      oldStart,
      oldEnd,
      size,
    });
  }
  return gaps;
}

/** Reveal `lines` immediately above hunk `hunkIndex` (context adjacent to its top). */
export function mergeRevealedAbove(
  file: ParsedDiffFile,
  hunkIndex: number,
  lines: readonly string[],
): ParsedDiffFile {
  if (lines.length === 0) {
    return file;
  }
  const hunks = file.hunks.map(cloneHunk);
  const hunk = hunks[hunkIndex];
  if (!hunk) {
    return file;
  }
  const headerIndex = hunkHeaderIndex(hunk);
  const insertAt = headerIndex >= 0 ? headerIndex + 1 : 0;
  const count = lines.length;
  hunk.oldStart -= count;
  hunk.newStart -= count;
  hunk.oldCount += count;
  hunk.newCount += count;
  hunk.lines = [
    ...hunk.lines.slice(0, insertAt),
    ...lines.map(contextLine),
    ...hunk.lines.slice(insertAt),
  ];
  if (headerIndex >= 0) {
    hunk.lines[headerIndex] = { ...hunk.lines[headerIndex]!, content: formatHunkHeader(hunk) };
  }
  return { ...file, hunks };
}

/** Reveal `lines` immediately below hunk `hunkIndex` (context adjacent to its bottom). */
export function mergeRevealedBelow(
  file: ParsedDiffFile,
  hunkIndex: number,
  lines: readonly string[],
): ParsedDiffFile {
  if (lines.length === 0) {
    return file;
  }
  const hunks = file.hunks.map(cloneHunk);
  const hunk = hunks[hunkIndex];
  if (!hunk) {
    return file;
  }
  const count = lines.length;
  hunk.oldCount += count;
  hunk.newCount += count;
  hunk.lines = [...hunk.lines, ...lines.map(contextLine)];
  const headerIndex = hunkHeaderIndex(hunk);
  if (headerIndex >= 0) {
    hunk.lines[headerIndex] = { ...hunk.lines[headerIndex]!, content: formatHunkHeader(hunk) };
  }
  return { ...file, hunks };
}

export type ExpandDirection = "up" | "down" | "all";

/** The OLD-side line range to fetch for an expand action, and how to merge it. */
export interface ExpandRequest {
  oldStart: number;
  oldEnd: number;
  merge: "above" | "below";
  hunkIndex: number;
}

/**
 * Resolves an expand click on a gap into the line range to fetch and the hunk to
 * merge it into. "up" reveals the bottom of the gap (adjacent to the hunk below),
 * "down" reveals the top (adjacent to the hunk above), "all" reveals everything.
 */
export function resolveExpandRequest(
  gap: DiffContextGap,
  direction: ExpandDirection,
): ExpandRequest | null {
  if (direction === "all") {
    return { oldStart: gap.oldStart, oldEnd: gap.oldEnd, merge: "above", hunkIndex: gap.hunkIndex };
  }
  if (direction === "up") {
    const oldStart = Math.max(gap.oldStart, gap.oldEnd - EXPAND_CONTEXT_CHUNK + 1);
    return { oldStart, oldEnd: gap.oldEnd, merge: "above", hunkIndex: gap.hunkIndex };
  }
  if (gap.aboveHunkIndex === null) {
    return null;
  }
  const oldEnd = Math.min(gap.oldEnd, gap.oldStart + EXPAND_CONTEXT_CHUNK - 1);
  return { oldStart: gap.oldStart, oldEnd, merge: "below", hunkIndex: gap.aboveHunkIndex };
}
