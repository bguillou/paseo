import { useCallback, useMemo, type ReactElement } from "react";
import { StyleSheet } from "react-native-unistyles";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import type { WorkspaceStatusManagerEntry } from "./manager-model";
import { WorkspaceStatusManagerRow, type WorkspaceStatusManagerListProps } from "./manager-row";

const entryKey = (entry: WorkspaceStatusManagerEntry) => entry.id;

/** Drag a row to reorder; the pointer has to travel first, so the row's buttons still click. */
export function WorkspaceStatusManagerList({
  entries,
  disabled,
  onEdit,
  onMove,
  onReorder,
}: WorkspaceStatusManagerListProps): ReactElement {
  const data = useMemo(() => [...entries], [entries]);
  const handleDragEnd = useCallback(
    (next: WorkspaceStatusManagerEntry[]) => onReorder(next.map(entryKey)),
    [onReorder],
  );
  const renderItem = useCallback(
    ({ item, index }: DraggableRenderItemInfo<WorkspaceStatusManagerEntry>) => (
      <WorkspaceStatusManagerRow
        entry={item}
        index={index}
        count={data.length}
        disabled={disabled}
        onEdit={onEdit}
        onMove={onMove}
      />
    ),
    [data.length, disabled, onEdit, onMove],
  );
  return (
    <DraggableList
      data={data}
      keyExtractor={entryKey}
      renderItem={renderItem}
      onDragEnd={handleDragEnd}
      scrollEnabled={false}
      containerStyle={styles.list}
      testID="workspace-status-manager-list"
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[1],
  },
}));
