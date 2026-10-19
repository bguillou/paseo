import { useCallback, useMemo, type ReactElement } from "react";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import { StatusWorkspaceRow } from "@/components/sidebar/sidebar-status-list";
import {
  shouldShowSidebarHostLabels,
  type SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspacePinController } from "@/hooks/use-sidebar-workspace-pin";
import { useHostBadges } from "@/hosts/use-host-badges";
import { useProjectIcons } from "@/projects/icons";
import { useHostFeatureMap } from "@/runtime/host-features";
import { useHosts } from "@/runtime/host-runtime";

/**
 * A card is the row the grouped sidebar modes show, project icon and kebab included, so the
 * kanban and the sidebar cannot drift apart on what a workspace looks like or what it offers.
 */
export function useBoardCardRenderer(): (workspace: SidebarWorkspaceEntry) => ReactElement {
  const { projects, projectIconTargets } = useSidebarModel();
  const rowItems = useSidebarRowItems();
  const hostBadgeByServerId = useHostBadges({
    enabled: rowItems.host && shouldShowSidebarHostLabels(projects),
  });
  const projectIconByProjectViewKey = useProjectIcons({ projects: projectIconTargets });
  const hosts = useHosts();
  const serverIds = useMemo(() => hosts.map((host) => host.serverId), [hosts]);
  const supportsPinningByServerId = useHostFeatureMap(serverIds, "workspacePinning");
  const onToggleWorkspacePin = useSidebarWorkspacePinController();

  return useCallback(
    (workspace: SidebarWorkspaceEntry) => (
      <StatusWorkspaceRow
        key={workspace.workspaceKey}
        workspace={workspace}
        hostBadge={hostBadgeByServerId.get(workspace.serverId) ?? null}
        projectName={workspace.projectName}
        projectIconDataUri={projectIconByProjectViewKey.get(workspace.projectViewKey) ?? null}
        inStatusGroup={false}
        shortcutNumber={null}
        showShortcutBadge={false}
        canPin={supportsPinningByServerId.get(workspace.serverId) === true}
        onToggleWorkspacePin={onToggleWorkspacePin}
      />
    ),
    [
      hostBadgeByServerId,
      onToggleWorkspacePin,
      projectIconByProjectViewKey,
      supportsPinningByServerId,
    ],
  );
}
