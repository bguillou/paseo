import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { WorkspaceStatusDefinition } from "@getpaseo/protocol/messages";
import { PrStatusLeadingIcon } from "@/components/sidebar/sidebar-status-list";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative, isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import type { WorkspaceStatusManagerEntry } from "./manager-model";

/** The size the host pill's own glyphs use, so the row's trailing marks match the controls above it. */
const ICON_SIZE = 14;

/** Grows the trailing marks to a 44pt target without moving them off the trailing rail. */
const HIT_SLOP = (44 - ICON_SIZE) / 2;

const ThemedPencil = withUnistyles(Pencil);
const ThemedMoreHorizontal = withUnistyles(MoreHorizontal);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedArrowDown = withUnistyles(ArrowDown);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const moveUpIcon = <ThemedArrowUp size={ICON_SIZE} uniProps={mutedMapping} />;
const moveDownIcon = <ThemedArrowDown size={ICON_SIZE} uniProps={mutedMapping} />;

export type WorkspaceStatusMoveDirection = "up" | "down";

export interface WorkspaceStatusManagerListProps {
  entries: readonly WorkspaceStatusManagerEntry[];
  /** Disables editing only: the order is device-local and moves while the host is offline. */
  disabled: boolean;
  onEdit: (status: WorkspaceStatusDefinition) => void;
  onMove: (id: string, direction: WorkspaceStatusMoveDirection) => void;
  /** The shown ids in their new order, after a drag. */
  onReorder: (ids: string[]) => void;
}

/**
 * Hover on the plain outer `View`, press on the inner `Pressable` — docs/hover.md. Moving through
 * the menu is the only way on native, and the keyboard-reachable one on web, where the row also
 * drags, like a kanban column header.
 */
export function WorkspaceStatusManagerRow({
  entry,
  index,
  count,
  disabled,
  onEdit,
  onMove,
}: {
  entry: WorkspaceStatusManagerEntry;
  index: number;
  count: number;
  disabled: boolean;
  onEdit: (status: WorkspaceStatusDefinition) => void;
  onMove: (id: string, direction: WorkspaceStatusMoveDirection) => void;
}): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const { status } = entry;
  const edit = useCallback(() => {
    if (status) onEdit(status);
  }, [status, onEdit]);
  const moveUp = useCallback(() => onMove(entry.id, "up"), [entry.id, onMove]);
  const moveDown = useCallback(() => onMove(entry.id, "down"), [entry.id, onMove]);
  const leading = useMemo(() => <PrStatusLeadingIcon leading={entry.leading} />, [entry.leading]);
  const revealed = isHovered || isNative || isCompact;
  const trailingStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.trailing,
      !revealed && styles.trailingHidden,
      pressed && styles.trailingPressed,
    ],
    [revealed],
  );

  return (
    <View
      style={styles.row}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      testID={`workspace-status-manager-status-${entry.id}`}
    >
      <View style={styles.leading}>{leading}</View>
      <Text style={styles.name} numberOfLines={1}>
        {entry.label}
      </Text>
      {status ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspaceStatuses.manage.editStatus", { name: entry.label })}
          disabled={disabled}
          hitSlop={HIT_SLOP}
          onPress={edit}
          pointerEvents={revealed ? "auto" : "none"}
          style={trailingStyle}
          testID={`workspace-status-manager-edit-${status.id}`}
        >
          <ThemedPencil size={ICON_SIZE} uniProps={mutedMapping} />
        </Pressable>
      ) : null}
      <DropdownMenu compactMode="sheet">
        <DropdownMenuTrigger
          hitSlop={HIT_SLOP}
          style={trailingStyle}
          accessibilityRole={isWeb ? undefined : "button"}
          accessibilityLabel={t("workspaceStatuses.manage.statusOptions", { name: entry.label })}
          testID={`workspace-status-manager-menu-${entry.id}`}
        >
          <ThemedMoreHorizontal size={ICON_SIZE} uniProps={mutedMapping} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={200} sheetTitle={entry.label}>
          <DropdownMenuItem
            leading={moveUpIcon}
            disabled={index === 0}
            onSelect={moveUp}
            testID={`workspace-status-manager-move-up-${entry.id}`}
          >
            {t("workspaceStatuses.manage.moveUp")}
          </DropdownMenuItem>
          <DropdownMenuItem
            leading={moveDownIcon}
            disabled={index === count - 1}
            onSelect={moveDown}
            testID={`workspace-status-manager-move-down-${entry.id}`}
          >
            {t("workspaceStatuses.manage.moveDown")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
  },
  leading: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  trailing: {
    alignItems: "center",
    justifyContent: "center",
  },
  trailingHidden: {
    opacity: 0,
  },
  trailingPressed: {
    opacity: 0.6,
  },
}));
