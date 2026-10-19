import type { ReactElement } from "react";
import { View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { StyleSheet } from "react-native-unistyles";
import { KanbanView } from "@/kanban/kanban-view";
import { SidebarModelProvider } from "@/components/sidebar/sidebar-model";

/**
 * The kanban's own sidebar model: the sidebar's is mounted beside the routes, not above them, and
 * on compact it is inactive while the kanban is on screen.
 */
export function KanbanScreen(): ReactElement {
  const isFocused = useIsFocused();
  if (!isFocused) {
    return <View style={styles.container} />;
  }
  return (
    <SidebarModelProvider active>
      <KanbanView />
    </SidebarModelProvider>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
}));
