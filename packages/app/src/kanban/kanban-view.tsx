import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { MenuHeader } from "@/components/headers/menu-header";
import { SidebarDisplayPreferencesMenu } from "@/components/sidebar/display-preferences/menu";
import { Button } from "@/components/ui/button";
import { useWorkspaceStatuses } from "@/workspace-statuses";
import { WorkspaceStatusManagerModal } from "@/workspace-statuses/manager-modal";
import { KanbanColumns } from "./kanban-columns";
import { useBoard } from "./use-kanban";
import { useBoardCardRenderer } from "./use-kanban-card-renderer";

/**
 * Workspaces as cards in one column per status. Filters are the sidebar's own display menu, so
 * narrowing one narrows both.
 */
export function KanbanView(): ReactElement {
  const { t } = useTranslation();
  const kanban = useBoard();
  const renderCard = useBoardCardRenderer();
  const [managerOpen, setManagerOpen] = useState(false);
  const openManager = useCallback(() => setManagerOpen(true), []);
  const closeManager = useCallback(() => setManagerOpen(false), []);
  const canManageStatuses = useWorkspaceStatuses((state) =>
    Object.values(state.hosts).some((host) => host.status === "online"),
  );

  const headerActions = useMemo(
    () => (
      <View style={styles.headerActions}>
        {canManageStatuses ? (
          <Button variant="ghost" size="xs" onPress={openManager} testID="kanban-manage-statuses">
            {t("workspaceStatuses.manage.open")}
          </Button>
        ) : null}
        <SidebarDisplayPreferencesMenu />
      </View>
    ),
    [canManageStatuses, openManager, t],
  );

  return (
    <View style={styles.container}>
      <MenuHeader title={t("kanban.title")} rightContent={headerActions} />
      <KanbanColumns
        columns={kanban.columns}
        renderCard={renderCard}
        onMoveWorkspace={kanban.moveWorkspace}
        onMoveColumn={kanban.moveColumn}
        onDropColumn={kanban.dropColumn}
      />
      <WorkspaceStatusManagerModal visible={managerOpen} onClose={closeManager} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
