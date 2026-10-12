import type { TFunction } from "i18next";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { compareSidebarWorkspaceRows } from "@/hooks/sidebar-status-view-model";

export type PrStatusBucket = "in_review" | "in_progress" | "backlog" | "done";

// Actionable first, finished last: a PR awaiting review/merge sits above active work, which sits
// above untouched workspaces, with merged work last — mirroring the status mode's "done last".
export const PR_STATUS_BUCKET_ORDER: readonly PrStatusBucket[] = [
  "in_review",
  "in_progress",
  "backlog",
  "done",
] as const;

const PR_STATUS_BUCKET_LABEL_KEYS = {
  in_review: "sidebar.prStatusBucket.inReview",
  in_progress: "sidebar.prStatusBucket.inProgress",
  backlog: "sidebar.prStatusBucket.backlog",
  done: "sidebar.prStatusBucket.done",
} as const satisfies Record<PrStatusBucket, string>;

export function getPrStatusBucketLabel(bucket: PrStatusBucket, t: TFunction): string {
  return t(PR_STATUS_BUCKET_LABEL_KEYS[bucket]);
}

/**
 * Where a workspace sits in the PR lifecycle.
 *
 * A merged PR is done; any open PR (drafts included) is in review. With no open or merged PR the
 * split is whether work has started: a workspace whose agents have received a first message is in
 * progress, otherwise it is backlog. A closed-but-not-merged PR falls through to that same split.
 */
export function derivePrStatusBucket(entry: SidebarWorkspaceEntry): PrStatusBucket {
  if (entry.prHint?.state === "merged") return "done";
  if (entry.prHint?.state === "open") return "in_review";
  return entry.hasUserMessage ? "in_progress" : "backlog";
}

export interface PrStatusGroup {
  bucket: PrStatusBucket;
  label: string;
  rows: SidebarWorkspaceEntry[];
}

export function buildPrStatusGroups(
  workspaces: SidebarWorkspaceEntry[],
  projectNamesByViewKey: Map<string, string>,
  t: TFunction,
): PrStatusGroup[] {
  const bucketRows = new Map<PrStatusBucket, SidebarWorkspaceEntry[]>();

  for (const ws of workspaces) {
    const bucket = derivePrStatusBucket(ws);
    let rows = bucketRows.get(bucket);
    if (!rows) {
      rows = [];
      bucketRows.set(bucket, rows);
    }
    rows.push(ws);
  }

  const groups: PrStatusGroup[] = [];

  for (const bucket of PR_STATUS_BUCKET_ORDER) {
    const rows = bucketRows.get(bucket);
    if (!rows || rows.length === 0) continue;

    rows.sort((a, b) => compareSidebarWorkspaceRows(a, b, projectNamesByViewKey));
    groups.push({ bucket, label: getPrStatusBucketLabel(bucket, t), rows });
  }

  return groups;
}
