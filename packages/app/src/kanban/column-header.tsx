import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowLeft, ArrowRight, MoreHorizontal } from "lucide-react-native";
import { isWeb } from "@/constants/platform";
import { PrStatusLeadingIcon } from "@/components/sidebar/sidebar-status-list";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/styles/theme";
import type { KanbanColumn } from "./model";

const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundIconMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const moveLeftIcon = <ThemedArrowLeft size={14} uniProps={mutedIconMapping} />;
const moveRightIcon = <ThemedArrowRight size={14} uniProps={mutedIconMapping} />;

function renderMenuTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreHorizontal size={14} uniProps={hovered ? foregroundIconMapping : mutedIconMapping} />
  );
}

function menuTriggerStyle({ hovered = false }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.menuTrigger, hovered && styles.menuTriggerHovered];
}

/**
 * Icon, name, count, and the column's menu. Moving a column through the menu is the only way on
 * native, and the keyboard-reachable one on web, where the header also drags.
 */
export function KanbanColumnHeader({
  column,
  index,
  columnCount,
  onMoveColumn,
}: {
  column: KanbanColumn;
  index: number;
  columnCount: number;
  onMoveColumn: (columnId: string, direction: "left" | "right") => void;
}): ReactElement {
  const { t } = useTranslation();
  const moveLeft = useCallback(() => onMoveColumn(column.id, "left"), [column.id, onMoveColumn]);
  const moveRight = useCallback(() => onMoveColumn(column.id, "right"), [column.id, onMoveColumn]);
  const leading = useMemo(() => <PrStatusLeadingIcon leading={column.leading} />, [column.leading]);
  return (
    <View style={styles.header}>
      <View style={styles.headerLeading}>{leading}</View>
      <Text style={styles.headerTitle} numberOfLines={1}>
        {column.label}
      </Text>
      <Text style={styles.headerCount}>{column.rows.length}</Text>
      <DropdownMenu compactMode="sheet">
        <DropdownMenuTrigger
          hitSlop={8}
          style={menuTriggerStyle}
          accessibilityRole={isWeb ? undefined : "button"}
          accessibilityLabel={t("kanban.column.menu", { name: column.label })}
          testID={`kanban-column-menu-${column.id}`}
        >
          {renderMenuTriggerIcon}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={200} sheetTitle={column.label}>
          <DropdownMenuItem
            leading={moveLeftIcon}
            disabled={index === 0}
            onSelect={moveLeft}
            testID={`kanban-column-move-left-${column.id}`}
          >
            {t("kanban.column.moveLeft")}
          </DropdownMenuItem>
          <DropdownMenuItem
            leading={moveRightIcon}
            disabled={index === columnCount - 1}
            onSelect={moveRight}
            testID={`kanban-column-move-right-${column.id}`}
          >
            {t("kanban.column.moveRight")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[3],
    paddingRight: theme.spacing[2],
  },
  headerLeading: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flexShrink: 1,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  headerCount: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  menuTrigger: {
    padding: 4,
    borderRadius: theme.borderRadius.md,
  },
  menuTriggerHovered: {
    backgroundColor: theme.colors.interactionHighlight,
  },
}));
