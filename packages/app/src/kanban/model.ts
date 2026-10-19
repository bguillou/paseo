import type { TFunction } from "i18next";
import type { WorkspaceManualStatus } from "@getpaseo/protocol/messages";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { compareSidebarWorkspaceRows } from "@/hooks/sidebar-status-view-model";
import {
  buildAllPrStatusGroups,
  customPrStatusGroupId,
  derivePrStatusBucket,
  effectivePrStatusGroupId,
  resolveEffectivePrStatus,
  type PrStatusGroup,
} from "@/hooks/sidebar-pr-status-view-model";
import type { WorkspaceStatusCatalogs } from "@/workspace-statuses";

/** A kanban column is a PR-status group, empty or not. Its id is the group id. */
export type KanbanColumn = PrStatusGroup;

/** workspaceKey → the column a move was sent to, held until the host confirms it. */
export type KanbanPendingMoves = ReadonlyMap<string, KanbanPendingMove>;

export interface KanbanPendingMove {
  columnId: string;
  /** The manual status the move was made against; a change means the host has answered. */
  manualStatusKey: string;
}

export function manualStatusKey(manualStatus: SidebarWorkspaceEntry["manualStatus"]): string {
  return manualStatus ? `${manualStatus.statusId}@${manualStatus.baseline}` : "";
}

/**
 * Saved ids first, in saved order, then every column the saved order does not know about in its
 * default place. A status created after the user arranged the kanban lands at the end.
 */
export function orderBoardColumns<Column extends { id: string }>(
  columns: readonly Column[],
  columnOrder: readonly string[],
): Column[] {
  const rank = new Map(columnOrder.map((id, index) => [id, index] as const));
  const known = columns.filter((column) => rank.has(column.id));
  const unknown = columns.filter((column) => !rank.has(column.id));
  known.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...known, ...unknown];
}

export function buildBoardColumns(input: {
  workspaces: SidebarWorkspaceEntry[];
  projectNamesByViewKey: Map<string, string>;
  catalogs: WorkspaceStatusCatalogs;
  columnOrder: readonly string[];
  pendingMoves: KanbanPendingMoves;
  t: TFunction;
}): KanbanColumn[] {
  const groups = buildAllPrStatusGroups(
    input.workspaces,
    input.projectNamesByViewKey,
    input.catalogs,
    input.t,
  );
  const columns = input.pendingMoves.size > 0 ? applyPendingMoves(groups, input) : groups;
  return orderBoardColumns(columns, input.columnOrder);
}

function applyPendingMoves(
  groups: PrStatusGroup[],
  input: { pendingMoves: KanbanPendingMoves; projectNamesByViewKey: Map<string, string> },
): PrStatusGroup[] {
  const byId = new Map<string, PrStatusGroup>();
  for (const group of groups) {
    byId.set(group.id, { id: group.id, label: group.label, leading: group.leading, rows: [] });
  }
  const received = new Set<string>();
  for (const group of groups) {
    for (const row of group.rows) {
      const pending = input.pendingMoves.get(row.workspaceKey);
      const target = pending && byId.has(pending.columnId) ? pending.columnId : group.id;
      if (target !== group.id) received.add(target);
      byId.get(target)?.rows.push(row);
    }
  }
  const columns = [...byId.values()];
  for (const column of columns) {
    if (!received.has(column.id)) continue;
    column.rows.sort((a, b) => compareSidebarWorkspaceRows(a, b, input.projectNamesByViewKey));
  }
  return columns;
}

/**
 * Drops the pending moves the host has answered: the workspace is gone, it already shows in the
 * target column, or its manual status changed since the move was sent.
 */
export function prunePendingBoardMoves(
  pending: KanbanPendingMoves,
  entriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>,
  catalogs: WorkspaceStatusCatalogs,
): KanbanPendingMoves {
  let next: Map<string, KanbanPendingMove> | undefined;
  for (const [workspaceKey, move] of pending) {
    const entry = entriesByKey.get(workspaceKey);
    const settled =
      !entry ||
      manualStatusKey(entry.manualStatus) !== move.manualStatusKey ||
      effectivePrStatusGroupId(resolveEffectivePrStatus(entry, catalogs)) === move.columnId;
    if (!settled) continue;
    next ??= new Map(pending);
    next.delete(workspaceKey);
  }
  return next ?? pending;
}

export type KanbanMove =
  | { kind: "noop" }
  /** `manualStatus` absent clears it: the workspace goes back to its automatic status. */
  | { kind: "set"; manualStatus?: WorkspaceManualStatus }
  /** A custom column the workspace's own host has no status for. */
  | { kind: "unavailable" };

/**
 * What dropping a workspace on a column writes. Columns merge custom statuses across hosts by
 * name, so a custom column resolves to the status of that name on the workspace's own host.
 * Landing on the derived bucket clears the manual status rather than pinning what Paseo already
 * says; anything else is pinned against the derived bucket, like the Status menu does.
 */
export function resolveBoardMove(
  workspace: SidebarWorkspaceEntry,
  column: Pick<KanbanColumn, "id" | "leading">,
  catalogs: WorkspaceStatusCatalogs,
): KanbanMove {
  const current = effectivePrStatusGroupId(resolveEffectivePrStatus(workspace, catalogs));
  if (current === column.id) return { kind: "noop" };
  const derived = derivePrStatusBucket(workspace);
  if (column.leading.kind === "auto") {
    const bucket = column.leading.bucket;
    return bucket === derived
      ? { kind: "set" }
      : { kind: "set", manualStatus: { statusId: bucket, baseline: derived } };
  }
  const status = catalogs[workspace.serverId]?.find(
    (candidate) => customPrStatusGroupId(candidate) === column.id,
  );
  if (!status) return { kind: "unavailable" };
  return { kind: "set", manualStatus: { statusId: status.id, baseline: derived } };
}

/** The full column order after moving `id` one step left or right. */
export function moveBoardColumn(
  columnIds: readonly string[],
  id: string,
  direction: "left" | "right",
): string[] {
  const from = columnIds.indexOf(id);
  const to = direction === "left" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= columnIds.length) return [...columnIds];
  return moveBoardColumnTo(columnIds, id, columnIds[to]);
}

/** The full column order after dropping `id` where `overId` sits. */
export function moveBoardColumnTo(
  columnIds: readonly string[],
  id: string,
  overId: string,
): string[] {
  const from = columnIds.indexOf(id);
  const to = columnIds.indexOf(overId);
  if (from === -1 || to === -1 || from === to) return [...columnIds];
  const next = [...columnIds];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
