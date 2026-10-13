import { replaceEqualDeep } from "@tanstack/react-query";
import type { ParsedDiffFile, SubscribeCheckoutDiffResponse } from "@getpaseo/protocol/messages";

type DiffPayload = Omit<SubscribeCheckoutDiffResponse["payload"], "subscriptionId">;

/** File identity owns text-model reuse. Never reconstruct the hunk/token graph. */
export function retainDiffFiles(
  previous: ParsedDiffFile[],
  incoming: ParsedDiffFile[],
): ParsedDiffFile[] {
  if (previous === incoming) return previous;
  const byPath = new Map(previous.map((file) => [file.path, file]));
  let unchanged = previous.length === incoming.length;
  const files = incoming.map((file, index) => {
    const old = byPath.get(file.path);
    const retained = old && equalFile(old, file) ? old : file;
    unchanged &&= retained === previous[index];
    return retained;
  });
  return unchanged ? previous : files;
}

export function shareCheckoutDiff(previous: unknown, incoming: unknown): DiffPayload {
  const next = incoming as DiffPayload;
  const old = previous as DiffPayload | undefined;
  if (!old || old === next) return next;
  const files = retainDiffFiles(old.files, next.files);
  const error = replaceEqualDeep(old.error, next.error);
  return files === old.files &&
    error === old.error &&
    old.cwd === next.cwd &&
    old.requestId === next.requestId &&
    old.diffTooLarge === next.diffTooLarge
    ? old
    : { ...next, files, error };
}

export function shareCommitFileDiff(
  previous: unknown,
  incoming: unknown,
): { file: ParsedDiffFile | null } {
  const next = incoming as { file: ParsedDiffFile | null };
  const old = previous as typeof next | undefined;
  return old &&
    (old.file === next.file || (old.file && next.file && equalFile(old.file, next.file)))
    ? old
    : next;
}

/**
 * Compact content signature for a file's diff. "Viewed" state keys off this so
 * it auto-clears when the file's diff changes (matching GitHub). Content-based,
 * so it is stable across reloads where object identity is not. FNV-1a over the
 * same fields `equalFile` compares.
 */
export function computeDiffFileSignature(file: ParsedDiffFile): string {
  let hash = 0x811c9dc5;
  const mix = (value: string | number): void => {
    const text = typeof value === "number" ? String(value) : value;
    for (let i = 0; i < text.length; i++) {
      hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
    }
    // Field separator so adjacent values can't merge ("a","b" vs "ab").
    hash = Math.imul(hash ^ 0x1f, 0x01000193);
  };
  mix(file.path);
  mix(file.oldPath ?? "");
  mix(file.status ?? "");
  mix(file.isNew ? 1 : 0);
  mix(file.isDeleted ? 1 : 0);
  mix(file.additions);
  mix(file.deletions);
  for (const hunk of file.hunks) {
    mix(hunk.oldStart);
    mix(hunk.oldCount);
    mix(hunk.newStart);
    mix(hunk.newCount);
    for (const line of hunk.lines) {
      mix(line.type);
      mix(line.content);
    }
  }
  return (hash >>> 0).toString(36);
}

function equalFile(left: ParsedDiffFile, right: ParsedDiffFile): boolean {
  if (left === right) return true;
  if (
    left.path !== right.path ||
    left.oldPath !== right.oldPath ||
    left.status !== right.status ||
    left.isNew !== right.isNew ||
    left.isDeleted !== right.isDeleted ||
    left.additions !== right.additions ||
    left.deletions !== right.deletions ||
    left.hunks.length !== right.hunks.length
  )
    return false;
  for (let h = 0; h < left.hunks.length; h++) {
    const a = left.hunks[h]!;
    const b = right.hunks[h]!;
    if (a === b) continue;
    if (
      a.oldStart !== b.oldStart ||
      a.oldCount !== b.oldCount ||
      a.newStart !== b.newStart ||
      a.newCount !== b.newCount ||
      a.lines.length !== b.lines.length
    )
      return false;
    if (!equalLines(a.lines, b.lines)) return false;
  }
  return true;
}

function equalLines(
  left: ParsedDiffFile["hunks"][number]["lines"],
  right: ParsedDiffFile["hunks"][number]["lines"],
): boolean {
  for (let l = 0; l < left.length; l++) {
    const x = left[l]!;
    const y = right[l]!;
    if (x === y) continue;
    if (x.type !== y.type || x.content !== y.content) return false;
    if (x.tokens === y.tokens) continue;
    if (!x.tokens || !y.tokens || x.tokens.length !== y.tokens.length) return false;
    for (let t = 0; t < x.tokens.length; t++) {
      const p = x.tokens[t]!;
      const q = y.tokens[t]!;
      if (p.text !== q.text || p.style !== q.style) return false;
    }
  }
  return true;
}
