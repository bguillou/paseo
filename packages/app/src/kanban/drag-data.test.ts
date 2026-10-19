import { describe, expect, it } from "vitest";
import { readBoardDragData } from "./drag-data";

describe("readBoardDragData", () => {
  it("reads the column and card shapes the kanban sets", () => {
    expect(readBoardDragData({ current: { type: "column", columnId: "done" } })).toEqual({
      type: "column",
      columnId: "done",
    });
    expect(
      readBoardDragData({ current: { type: "card", workspaceKey: "srv:a", columnId: "backlog" } }),
    ).toEqual({ type: "card", workspaceKey: "srv:a", columnId: "backlog" });
  });

  it("rejects anything else", () => {
    expect(readBoardDragData(undefined)).toBeUndefined();
    expect(readBoardDragData({ current: { type: "card", columnId: "done" } })).toBeUndefined();
    expect(readBoardDragData({ current: { sortable: { index: 0 } } })).toBeUndefined();
  });
});
