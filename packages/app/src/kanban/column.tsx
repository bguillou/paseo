import type { ReactElement, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import type { KanbanColumn } from "./model";

export const KANBAN_COLUMN_WIDTH = 300;

/** What a platform's column list needs from the screen. */
export interface KanbanColumnsProps {
  columns: KanbanColumn[];
  renderCard: (workspace: SidebarWorkspaceEntry) => ReactElement;
  onMoveWorkspace: (workspace: SidebarWorkspaceEntry, columnId: string) => void;
  onMoveColumn: (columnId: string, direction: "left" | "right") => void;
  onDropColumn: (columnId: string, overColumnId: string) => void;
}

/** One column: its header (the children) on top, its cards scrolling under it. */
export function KanbanColumnFrame({
  column,
  children,
  highlighted = false,
  renderCard,
}: {
  column: KanbanColumn;
  children: ReactNode;
  highlighted?: boolean;
  renderCard: (workspace: SidebarWorkspaceEntry) => ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <View
      style={[styles.column, highlighted && styles.columnHighlighted]}
      testID={`kanban-column-${column.id}`}
    >
      {children}
      <ScrollView
        style={styles.cards}
        contentContainerStyle={styles.cardsContent}
        showsVerticalScrollIndicator={false}
      >
        {column.rows.length === 0 ? (
          <Text style={styles.empty}>{t("kanban.column.empty")}</Text>
        ) : (
          column.rows.map(renderCard)
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  column: {
    width: KANBAN_COLUMN_WIDTH,
    flex: 1,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surfaceSidebar,
    borderWidth: 1,
    borderColor: "transparent",
    overflow: "hidden",
  },
  columnHighlighted: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  cards: {
    flex: 1,
  },
  cardsContent: {
    paddingHorizontal: theme.spacing[1],
    paddingBottom: theme.spacing[2],
    gap: theme.spacing[0.5],
  },
  empty: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
