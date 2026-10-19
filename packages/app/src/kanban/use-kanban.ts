import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useToast } from "@/contexts/toast-context";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { useWorkspaceStatusCatalogs, workspaceStatuses } from "@/workspace-statuses";
import { useBoardColumnOrderStore } from "./column-order-store";
import {
  buildBoardColumns,
  manualStatusKey,
  moveBoardColumn,
  moveBoardColumnTo,
  prunePendingBoardMoves,
  resolveBoardMove,
  type KanbanColumn,
  type KanbanPendingMoves,
} from "./model";

const NO_PENDING_MOVES: KanbanPendingMoves = new Map();

export interface KanbanController {
  columns: KanbanColumn[];
  moveWorkspace: (workspace: SidebarWorkspaceEntry, columnId: string) => void;
  moveColumn: (columnId: string, direction: "left" | "right") => void;
  dropColumn: (columnId: string, overColumnId: string) => void;
}

/**
 * The kanban reads the nearest `SidebarModelProvider`, so it shows exactly what the sidebar's
 * host, project, and label filters let through.
 */
export function useBoard(): KanbanController {
  const { t } = useTranslation();
  const toast = useToast();
  const { workspaceEntriesByKey, projectNamesByViewKey } = useSidebarModel();
  const catalogs = useWorkspaceStatusCatalogs();
  const columnOrder = useBoardColumnOrderStore((state) => state.columnOrder);
  const setColumnOrder = useBoardColumnOrderStore((state) => state.setColumnOrder);
  const [sentMoves, setSentMoves] = useState<KanbanPendingMoves>(NO_PENDING_MOVES);

  // A dropped card stays in its target column until the workspace update arrives; the RPC
  // response can land before it, so the response alone would flash the card back for a frame.
  const pendingMoves = useMemo(
    () => prunePendingBoardMoves(sentMoves, workspaceEntriesByKey, catalogs),
    [sentMoves, workspaceEntriesByKey, catalogs],
  );
  // Forget answered moves, so a later status change cannot bring a stale one back.
  useEffect(() => {
    if (pendingMoves !== sentMoves) setSentMoves(pendingMoves);
  }, [pendingMoves, sentMoves]);

  const workspaces = useMemo(() => [...workspaceEntriesByKey.values()], [workspaceEntriesByKey]);
  const columns = useMemo(
    () =>
      buildBoardColumns({
        workspaces,
        projectNamesByViewKey,
        catalogs,
        columnOrder,
        pendingMoves,
        t,
      }),
    [workspaces, projectNamesByViewKey, catalogs, columnOrder, pendingMoves, t],
  );

  const forgetMove = useCallback((workspaceKey: string) => {
    setSentMoves((previous) => {
      if (!previous.has(workspaceKey)) return previous;
      const next = new Map(previous);
      next.delete(workspaceKey);
      return next;
    });
  }, []);

  const moveWorkspace = useCallback(
    (workspace: SidebarWorkspaceEntry, columnId: string) => {
      const column = columns.find((candidate) => candidate.id === columnId);
      if (!column) return;
      const move = resolveBoardMove(workspace, column, catalogs);
      if (move.kind === "noop") return;
      if (move.kind === "unavailable") {
        toast.error(t("kanban.errors.statusUnavailable", { status: column.label }));
        return;
      }
      const { workspaceKey } = workspace;
      setSentMoves((previous) =>
        new Map(previous).set(workspaceKey, {
          columnId,
          manualStatusKey: manualStatusKey(workspace.manualStatus),
        }),
      );
      workspaceStatuses
        .setManualStatus({
          serverId: workspace.serverId,
          workspaceId: workspace.workspaceId,
          manualStatus: move.manualStatus ?? null,
        })
        .catch(() => {
          forgetMove(workspaceKey);
          toast.error(t("workspaceStatuses.errors.update"));
        });
    },
    [catalogs, columns, forgetMove, t, toast],
  );

  const columnIds = useMemo(() => columns.map((column) => column.id), [columns]);
  const moveColumn = useCallback(
    (columnId: string, direction: "left" | "right") => {
      setColumnOrder(moveBoardColumn(columnIds, columnId, direction));
    },
    [columnIds, setColumnOrder],
  );
  const dropColumn = useCallback(
    (columnId: string, overColumnId: string) => {
      setColumnOrder(moveBoardColumnTo(columnIds, columnId, overColumnId));
    },
    [columnIds, setColumnOrder],
  );

  return { columns, moveWorkspace, moveColumn, dropColumn };
}
