import { useCallback, useMemo, type CSSProperties, type ReactElement } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { KanbanColumnFrame } from "./column";
import { KanbanColumnHeader } from "./column-header";
import { COLUMN_DND_PREFIX, type KanbanDragData } from "./drag-data";
import { DraggableBoardCard } from "./draggable-card.web";
import type { KanbanColumn } from "./model";

const wrapperStyle: CSSProperties = { display: "flex", flexDirection: "column", height: "100%" };
const handleStyle: CSSProperties = { cursor: "grab" };

/** A column that drags by its header and accepts dropped cards anywhere on it. */
export function SortableBoardColumn({
  column,
  index,
  columnCount,
  highlighted,
  renderCard,
  onMoveColumn,
}: {
  column: KanbanColumn;
  index: number;
  columnCount: number;
  highlighted: boolean;
  renderCard: (workspace: SidebarWorkspaceEntry) => ReactElement;
  onMoveColumn: (columnId: string, direction: "left" | "right") => void;
}): ReactElement {
  const { setNodeRef, setActivatorNodeRef, listeners, transform, transition, isDragging } =
    useSortable({
      id: COLUMN_DND_PREFIX + column.id,
      data: { type: "column", columnId: column.id } satisfies KanbanDragData,
    });
  const style = useMemo<CSSProperties>(
    () => ({
      ...wrapperStyle,
      transform: CSS.Translate.toString(transform),
      transition,
      opacity: isDragging ? 0.6 : 1,
      zIndex: isDragging ? 1 : undefined,
    }),
    [isDragging, transform, transition],
  );
  const renderDraggableCard = useCallback(
    (workspace: SidebarWorkspaceEntry) => (
      <DraggableBoardCard
        key={workspace.workspaceKey}
        workspaceKey={workspace.workspaceKey}
        columnId={column.id}
      >
        {renderCard(workspace)}
      </DraggableBoardCard>
    ),
    [column.id, renderCard],
  );

  return (
    <div ref={setNodeRef} style={style}>
      <KanbanColumnFrame column={column} highlighted={highlighted} renderCard={renderDraggableCard}>
        <div ref={setActivatorNodeRef} {...listeners} style={handleStyle}>
          <KanbanColumnHeader
            column={column}
            index={index}
            columnCount={columnCount}
            onMoveColumn={onMoveColumn}
          />
        </div>
      </KanbanColumnFrame>
    </div>
  );
}
