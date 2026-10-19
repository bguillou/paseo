import { useCallback, useEffect, useId, type ReactElement } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { ScrollView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { useHorizontalScrollOptional } from "@/contexts/horizontal-scroll-context";
import { KanbanColumnFrame, type KanbanColumnsProps } from "./column";
import { KanbanColumnHeader } from "./column-header";

/**
 * No drag and drop on native: a card changes column through its Status menu, a column moves
 * through its header menu.
 */
export function KanbanColumns({
  columns,
  renderCard,
  onMoveColumn,
}: KanbanColumnsProps): ReactElement {
  const horizontalScroll = useHorizontalScrollOptional();
  const scrollId = useId();
  useEffect(() => {
    return () => horizontalScroll?.unregisterScrollOffset(scrollId);
  }, [horizontalScroll, scrollId]);
  // Reports the offset so the mobile panel swipe only opens the sidebar from the leading edge.
  const reportOffset = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      horizontalScroll?.registerScrollOffset(scrollId, event.nativeEvent.contentOffset.x);
    },
    [horizontalScroll, scrollId],
  );
  const beginGesture = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      horizontalScroll?.beginHorizontalGesture(event.nativeEvent.contentOffset.x);
    },
    [horizontalScroll],
  );
  const endGesture = useCallback(() => {
    horizontalScroll?.endHorizontalGesture();
  }, [horizontalScroll]);

  return (
    <ScrollView
      horizontal
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsHorizontalScrollIndicator={false}
      onScroll={reportOffset}
      onScrollBeginDrag={beginGesture}
      onScrollEndDrag={endGesture}
      scrollEventThrottle={16}
      testID="kanban-columns"
    >
      {columns.map((column, index) => (
        <KanbanColumnFrame key={column.id} column={column} renderCard={renderCard}>
          <KanbanColumnHeader
            column={column}
            index={index}
            columnCount={columns.length}
            onMoveColumn={onMoveColumn}
          />
        </KanbanColumnFrame>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  scroll: {
    flex: 1,
  },
  content: {
    gap: theme.spacing[3],
    padding: theme.spacing[3],
  },
}));
