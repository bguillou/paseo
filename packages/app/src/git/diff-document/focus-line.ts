import { buildReviewableDiffTargetKey } from "@/utils/diff-layout";
import type { DiffDocumentModel } from "./types";

/**
 * Scroll offset (row top) of a file's new-side line, or null when the line isn't in
 * the diff. Lines are matched by the same ReviewableDiffTarget key the PR inline
 * overlay anchors on, so "jump to comment" lands on the exact commented line.
 */
export function findFocusLineTop(
  model: DiffDocumentModel,
  path: string,
  line: number,
): number | null {
  const targetKey = buildReviewableDiffTargetKey({ filePath: path, side: "new", lineNumber: line });
  for (const row of model.rows) {
    if (row.kind !== "line" || row.path !== path) {
      continue;
    }
    for (const cell of row.cells) {
      if (cell?.reviewTarget?.key === targetKey) {
        return row.top;
      }
    }
  }
  return null;
}
