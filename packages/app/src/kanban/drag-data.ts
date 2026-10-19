/** What a draggable on the web kanban carries, so a drop knows what moved and from where. */
export type KanbanDragData =
  | { type: "column"; columnId: string }
  | { type: "card"; workspaceKey: string; columnId: string };

export const COLUMN_DND_PREFIX = "column:";
export const CARD_DND_PREFIX = "card:";

/** dnd-kit types `data.current` as an open record; this narrows it back to what the kanban set. */
export function readBoardDragData(
  data: { current?: Record<string, unknown> } | undefined,
): KanbanDragData | undefined {
  const value = data?.current;
  if (value?.type === "column" && typeof value.columnId === "string") {
    return { type: "column", columnId: value.columnId };
  }
  if (
    value?.type === "card" &&
    typeof value.workspaceKey === "string" &&
    typeof value.columnId === "string"
  ) {
    return { type: "card", workspaceKey: value.workspaceKey, columnId: value.columnId };
  }
  return undefined;
}
