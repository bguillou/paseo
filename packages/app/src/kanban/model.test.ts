import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import {
  buildBoardColumns,
  manualStatusKey,
  moveBoardColumn,
  moveBoardColumnTo,
  orderBoardColumns,
  prunePendingBoardMoves,
  resolveBoardMove,
  type KanbanPendingMoves,
} from "./model";

function ws(
  input: Partial<SidebarWorkspaceEntry> & { workspaceKey: string },
): SidebarWorkspaceEntry {
  return {
    serverId: input.serverId ?? "srv",
    workspaceId: input.workspaceId ?? input.workspaceKey.split(":")[1] ?? "ws",
    projectViewKey: input.projectViewKey ?? "proj",
    projectName: input.projectName ?? "Project",
    projectRootPath: input.projectRootPath,
    workspaceDirectory: input.workspaceDirectory ?? "",
    workspaceDirectoryLabel: input.workspaceDirectoryLabel ?? "",
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "worktree",
    name: input.name ?? input.workspaceKey,
    title: input.title ?? null,
    currentBranch: input.currentBranch ?? null,
    baseRef: null,
    statusBucket: input.statusBucket ?? "done",
    statusEnteredAt: input.statusEnteredAt ?? null,
    archivingAt: null,
    diffStat: null,
    prHint: input.prHint ?? null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    hasUserMessage: input.hasUserMessage ?? false,
    manualStatus: input.manualStatus ?? null,
    workspaceKey: input.workspaceKey,
  };
}

const blocked = { id: "sts_blocked", name: "Blocked", color: "red" } as const;
const otherBlocked = { id: "sts_other_blocked", name: "blocked", color: "amber" } as const;
const catalogs = { srv: [blocked], other: [otherBlocked] };
const noPending: KanbanPendingMoves = new Map();
const projectNames = new Map<string, string>();

function columnSummary(input: Parameters<typeof buildBoardColumns>[0]) {
  return buildBoardColumns(input).map((column) => ({
    id: column.id,
    rows: column.rows.map((row) => row.workspaceKey),
  }));
}

describe("buildBoardColumns", () => {
  it("keeps every column, empty ones included, merging custom statuses by name", () => {
    expect(
      columnSummary({
        workspaces: [ws({ workspaceKey: "srv:a", hasUserMessage: true })],
        projectNamesByViewKey: projectNames,
        catalogs,
        columnOrder: [],
        pendingMoves: noPending,
        t: i18n.t,
      }),
    ).toEqual([
      { id: "in_review", rows: [] },
      { id: "in_progress", rows: ["srv:a"] },
      { id: "backlog", rows: [] },
      { id: "done", rows: [] },
      { id: "custom:blocked", rows: [] },
    ]);
  });

  it("shows a pending move in its target column until it settles", () => {
    const pendingMoves: KanbanPendingMoves = new Map([
      ["srv:a", { columnId: "custom:blocked", manualStatusKey: "" }],
    ]);
    const columns = columnSummary({
      workspaces: [ws({ workspaceKey: "srv:a" }), ws({ workspaceKey: "srv:b" })],
      projectNamesByViewKey: projectNames,
      catalogs,
      columnOrder: [],
      pendingMoves,
      t: i18n.t,
    });
    expect(columns.find((column) => column.id === "backlog")?.rows).toEqual(["srv:b"]);
    expect(columns.find((column) => column.id === "custom:blocked")?.rows).toEqual(["srv:a"]);
  });

  it("follows the saved column order", () => {
    const columns = columnSummary({
      workspaces: [],
      projectNamesByViewKey: projectNames,
      catalogs,
      columnOrder: ["done", "custom:blocked"],
      pendingMoves: noPending,
      t: i18n.t,
    });
    expect(columns.map((column) => column.id)).toEqual([
      "done",
      "custom:blocked",
      "in_review",
      "in_progress",
      "backlog",
    ]);
  });
});

describe("orderBoardColumns", () => {
  it("ignores saved ids that no longer exist and appends new columns", () => {
    const columns = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(orderBoardColumns(columns, ["gone", "c", "a"]).map((column) => column.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });
});

describe("resolveBoardMove", () => {
  const backlog = { id: "backlog", leading: { kind: "auto", bucket: "backlog" } } as const;
  const done = { id: "done", leading: { kind: "auto", bucket: "done" } } as const;
  const blockedColumn = {
    id: "custom:blocked",
    leading: { kind: "custom", color: "red" },
  } as const;

  it("does nothing when the workspace already shows in the column", () => {
    expect(resolveBoardMove(ws({ workspaceKey: "srv:a" }), backlog, catalogs)).toEqual({
      kind: "noop",
    });
  });

  it("pins an auto status against the derived bucket", () => {
    expect(resolveBoardMove(ws({ workspaceKey: "srv:a" }), done, catalogs)).toEqual({
      kind: "set",
      manualStatus: { statusId: "done", baseline: "backlog" },
    });
  });

  it("clears the manual status when moved back to the derived bucket", () => {
    const pinned = ws({
      workspaceKey: "srv:a",
      manualStatus: { statusId: "sts_blocked", baseline: "backlog" },
    });
    expect(resolveBoardMove(pinned, backlog, catalogs)).toEqual({ kind: "set" });
  });

  it("resolves a custom column to the status of that name on the workspace's host", () => {
    expect(
      resolveBoardMove(ws({ workspaceKey: "other:a", serverId: "other" }), blockedColumn, catalogs),
    ).toEqual({
      kind: "set",
      manualStatus: { statusId: "sts_other_blocked", baseline: "backlog" },
    });
  });

  it("refuses a custom column the workspace's host does not have", () => {
    expect(
      resolveBoardMove(ws({ workspaceKey: "third:a", serverId: "third" }), blockedColumn, catalogs),
    ).toEqual({ kind: "unavailable" });
  });
});

describe("prunePendingBoardMoves", () => {
  it("keeps a move the host has not answered yet", () => {
    const pending: KanbanPendingMoves = new Map([
      ["srv:a", { columnId: "done", manualStatusKey: "" }],
    ]);
    const entries = new Map([["srv:a", ws({ workspaceKey: "srv:a" })]]);
    expect(prunePendingBoardMoves(pending, entries, catalogs)).toBe(pending);
  });

  it("drops a move once the manual status changed or the workspace is gone", () => {
    const manualStatus = { statusId: "done", baseline: "backlog" } as const;
    const pending: KanbanPendingMoves = new Map([
      ["srv:a", { columnId: "done", manualStatusKey: "" }],
      ["srv:gone", { columnId: "done", manualStatusKey: "" }],
    ]);
    const entries = new Map([["srv:a", ws({ workspaceKey: "srv:a", manualStatus })]]);
    expect(prunePendingBoardMoves(pending, entries, catalogs).size).toBe(0);
    expect(manualStatusKey(manualStatus)).toBe("done@backlog");
  });
});

describe("moveBoardColumn", () => {
  const ids = ["a", "b", "c"];

  it("moves one step and stops at the edges", () => {
    expect(moveBoardColumn(ids, "b", "left")).toEqual(["b", "a", "c"]);
    expect(moveBoardColumn(ids, "b", "right")).toEqual(["a", "c", "b"]);
    expect(moveBoardColumn(ids, "a", "left")).toEqual(ids);
    expect(moveBoardColumn(ids, "c", "right")).toEqual(ids);
  });

  it("drops a column where another sits", () => {
    expect(moveBoardColumnTo(ids, "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveBoardColumnTo(ids, "c", "a")).toEqual(["c", "a", "b"]);
  });
});
