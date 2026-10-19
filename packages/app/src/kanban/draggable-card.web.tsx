import type { CSSProperties, ReactElement } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CARD_DND_PREFIX, type KanbanDragData } from "./drag-data";

const draggingStyle: CSSProperties = { opacity: 0.4 };

export function DraggableBoardCard({
  workspaceKey,
  columnId,
  children,
}: {
  workspaceKey: string;
  columnId: string;
  children: ReactElement;
}): ReactElement {
  // Listeners only, no `attributes`: the row inside is already the focusable, labelled control,
  // and a second tab stop around it would announce the workspace twice.
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: CARD_DND_PREFIX + workspaceKey,
    data: { type: "card", workspaceKey, columnId } satisfies KanbanDragData,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      style={isDragging ? draggingStyle : undefined}
      data-testid={`kanban-card-${workspaceKey}`}
    >
      {children}
    </div>
  );
}
