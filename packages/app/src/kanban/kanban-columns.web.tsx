import { useCallback, useMemo, useState, type CSSProperties, type ReactElement } from "react";
import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import { KANBAN_COLUMN_WIDTH, type KanbanColumnsProps } from "./column";
import { COLUMN_DND_PREFIX, readBoardDragData, type KanbanDragData } from "./drag-data";
import { SortableBoardColumn } from "./sortable-column.web";

// Columns are the only droppables. A card lands on the column under the pointer, falling back to
// the one it overlaps when the pointer leaves every column; a column swaps with the nearest one.
const kanbanCollisionDetection: CollisionDetection = (args) => {
  if (readBoardDragData(args.active.data)?.type === "card") {
    const within = pointerWithin(args);
    return within.length > 0 ? within : rectIntersection(args);
  }
  return closestCenter(args);
};

/**
 * Drag a card onto a column to change its status; drag a column by its header to reorder. The
 * pointer has to travel before a drag starts, so a click still opens the workspace.
 */
export function KanbanColumns({
  columns,
  renderCard,
  onMoveWorkspace,
  onMoveColumn,
  onDropColumn,
}: KanbanColumnsProps): ReactElement {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const [activeDrag, setActiveDrag] = useState<KanbanDragData | undefined>();
  const [overColumnId, setOverColumnId] = useState<string | undefined>();

  const workspacesByKey = useMemo(() => {
    const map = new Map<string, SidebarWorkspaceEntry>();
    for (const column of columns) {
      for (const row of column.rows) map.set(row.workspaceKey, row);
    }
    return map;
  }, [columns]);
  const sortableIds = useMemo(
    () => columns.map((column) => COLUMN_DND_PREFIX + column.id),
    [columns],
  );

  const reset = useCallback(() => {
    setActiveDrag(undefined);
    setOverColumnId(undefined);
  }, []);
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDrag(readBoardDragData(event.active.data));
  }, []);
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const over = readBoardDragData(event.over?.data);
    setOverColumnId(over?.type === "column" ? over.columnId : undefined);
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const active = readBoardDragData(event.active.data);
      const over = readBoardDragData(event.over?.data);
      reset();
      if (!active || over?.type !== "column") return;
      if (active.type === "column") {
        if (active.columnId !== over.columnId) onDropColumn(active.columnId, over.columnId);
        return;
      }
      const workspace = workspacesByKey.get(active.workspaceKey);
      if (workspace && active.columnId !== over.columnId) {
        onMoveWorkspace(workspace, over.columnId);
      }
    },
    [onDropColumn, onMoveWorkspace, reset, workspacesByKey],
  );

  const draggedCard =
    activeDrag?.type === "card" ? workspacesByKey.get(activeDrag.workspaceKey) : undefined;
  const cardSourceColumnId = activeDrag?.type === "card" ? activeDrag.columnId : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanCollisionDetection}
      autoScroll={KANBAN_AUTO_SCROLL}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={reset}
    >
      <ScrollView
        horizontal
        style={styles.scroll}
        contentContainerStyle={styles.content}
        testID="kanban-columns"
      >
        <SortableContext items={sortableIds} strategy={horizontalListSortingStrategy}>
          {columns.map((column, index) => (
            <SortableBoardColumn
              key={column.id}
              column={column}
              index={index}
              columnCount={columns.length}
              highlighted={
                cardSourceColumnId !== undefined &&
                overColumnId === column.id &&
                cardSourceColumnId !== column.id
              }
              renderCard={renderCard}
              onMoveColumn={onMoveColumn}
            />
          ))}
        </SortableContext>
      </ScrollView>
      <DragOverlay dropAnimation={null}>
        {draggedCard ? <div style={overlayStyle}>{renderCard(draggedCard)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
}

// dnd-kit scrolls once the pointer is within 20% of an edge by default: a fifth of a wide kanban is
// most of the last column, which then scrolls away from under the card being dropped on it.
const KANBAN_AUTO_SCROLL = { threshold: { x: 0.08, y: 0.2 } };
const overlayStyle: CSSProperties = { width: KANBAN_COLUMN_WIDTH - 8, cursor: "grabbing" };

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
  },
  content: {
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
}));
