import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { WorkspaceStatusManagerRow, type WorkspaceStatusManagerListProps } from "./manager-row";

/** No drag and drop on native: a status moves through its row menu, like a kanban column. */
export function WorkspaceStatusManagerList({
  entries,
  disabled,
  onEdit,
  onMove,
}: WorkspaceStatusManagerListProps): ReactElement {
  return (
    <View style={styles.list}>
      {entries.map((entry, index) => (
        <WorkspaceStatusManagerRow
          key={entry.id}
          entry={entry}
          index={index}
          count={entries.length}
          disabled={disabled}
          onEdit={onEdit}
          onMove={onMove}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[1],
  },
}));
