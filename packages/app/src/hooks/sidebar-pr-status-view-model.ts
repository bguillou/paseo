import type { TFunction } from "i18next";
import type { WorkspaceStatusDefinition } from "@getpaseo/protocol/messages";
import {
  WORKSPACE_AUTO_STATUSES,
  type WorkspaceAutoStatus,
} from "@getpaseo/protocol/workspace-statuses";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { compareSidebarWorkspaceRows } from "@/hooks/sidebar-status-view-model";
import type { WorkspaceStatusCatalogs } from "@/workspace-statuses";

export type PrStatusBucket = WorkspaceAutoStatus;

// Actionable first, finished last: a PR awaiting review/merge sits above active work, which sits
// above untouched workspaces, with merged work last — mirroring the status mode's "done last".
export const PR_STATUS_BUCKET_ORDER: readonly PrStatusBucket[] = WORKSPACE_AUTO_STATUSES;

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

export type EffectivePrStatus =
  | { kind: "auto"; bucket: PrStatusBucket }
  | { kind: "custom"; status: WorkspaceStatusDefinition };

/**
 * The status a workspace shows: its manual status while the derived bucket still equals the
 * baseline it was assigned against, the derived bucket otherwise. A custom status missing from
 * its host's catalog (deleted, or the catalog not loaded yet) also falls back to the derived one.
 */
export function resolveEffectivePrStatus(
  entry: SidebarWorkspaceEntry,
  catalogs: WorkspaceStatusCatalogs,
): EffectivePrStatus {
  const derived = derivePrStatusBucket(entry);
  const manual = entry.manualStatus;
  if (!manual || manual.baseline !== derived) return { kind: "auto", bucket: derived };
  const autoBucket = PR_STATUS_BUCKET_ORDER.find((bucket) => bucket === manual.statusId);
  if (autoBucket) return { kind: "auto", bucket: autoBucket };
  const custom = catalogs[entry.serverId]?.find((status) => status.id === manual.statusId);
  return custom ? { kind: "custom", status: custom } : { kind: "auto", bucket: derived };
}

export type PrStatusGroupLeading =
  | { kind: "auto"; bucket: PrStatusBucket }
  | { kind: "custom"; color: WorkspaceStatusDefinition["color"] };

export interface PrStatusGroup {
  /** The auto bucket, or `custom:` plus the lowercased name, so hosts sharing a name share a group. */
  id: string;
  label: string;
  leading: PrStatusGroupLeading;
  rows: SidebarWorkspaceEntry[];
}

function customGroupId(status: WorkspaceStatusDefinition): string {
  return `custom:${status.name.toLowerCase()}`;
}

/**
 * Auto buckets in their fixed order, then custom statuses in catalog order, hosts taken in
 * serverId order. Only non-empty groups are returned.
 */
export function buildPrStatusGroups(
  workspaces: SidebarWorkspaceEntry[],
  projectNamesByViewKey: Map<string, string>,
  catalogs: WorkspaceStatusCatalogs,
  t: TFunction,
): PrStatusGroup[] {
  const ordered = new Map<string, Omit<PrStatusGroup, "rows">>();
  for (const bucket of PR_STATUS_BUCKET_ORDER) {
    ordered.set(bucket, {
      id: bucket,
      label: getPrStatusBucketLabel(bucket, t),
      leading: { kind: "auto", bucket },
    });
  }
  for (const serverId of Object.keys(catalogs).sort()) {
    for (const status of catalogs[serverId] ?? []) {
      const id = customGroupId(status);
      if (!ordered.has(id)) {
        ordered.set(id, {
          id,
          label: status.name,
          leading: { kind: "custom", color: status.color },
        });
      }
    }
  }

  const rowsById = new Map<string, SidebarWorkspaceEntry[]>();
  for (const ws of workspaces) {
    const effective = resolveEffectivePrStatus(ws, catalogs);
    const id = effective.kind === "auto" ? effective.bucket : customGroupId(effective.status);
    const rows = rowsById.get(id);
    if (rows) rows.push(ws);
    else rowsById.set(id, [ws]);
  }

  const groups: PrStatusGroup[] = [];
  for (const group of ordered.values()) {
    const rows = rowsById.get(group.id);
    if (!rows || rows.length === 0) continue;
    rows.sort((a, b) => compareSidebarWorkspaceRows(a, b, projectNamesByViewKey));
    groups.push({ ...group, rows });
  }
  return groups;
}
