import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceManualStatus, WorkspaceStatusDefinition } from "@getpaseo/protocol/messages";
import {
  MenuHint,
  MenuItem,
  MenuSeparator,
  useMenuContext,
  type MenuPageDefinition,
} from "@/components/ui/menu";
import type { SidebarWorkspaceEntry } from "@/hooks/sidebar-workspaces-view-model";
import {
  derivePrStatusBucket,
  getPrStatusBucketLabel,
  PR_STATUS_BUCKET_ORDER,
  resolveEffectivePrStatus,
} from "@/hooks/sidebar-pr-status-view-model";
import { WorkspaceLabelDot } from "@/workspace-labels/swatch";
import {
  useWorkspaceStatusCatalogs,
  useWorkspaceStatusHost,
  workspaceStatuses,
} from "@/workspace-statuses";

/** The `MenuSubTrigger` on a workspace's menu that opens the status page. */
export const WORKSPACE_STATUS_PAGE_ID = "workspaceStatus";

const AUTOMATIC_ID = "automatic";
const NO_PAGES: readonly MenuPageDefinition[] = [];

export function useWorkspaceStatusMenuPages(
  workspace: SidebarWorkspaceEntry | null,
): readonly MenuPageDefinition[] {
  const { t } = useTranslation();
  return useMemo(() => {
    if (!workspace) return NO_PAGES;
    return [
      {
        id: WORKSPACE_STATUS_PAGE_ID,
        title: t("workspaceStatuses.title"),
        content: <WorkspaceStatusPickerPage workspace={workspace} />,
      },
    ];
  }, [t, workspace]);
}

/** Whether the workspace's host can store a manual status; gates the menu row. */
export function useSupportsWorkspaceStatuses(serverId: string | undefined): boolean {
  return useWorkspaceStatusHost(serverId ?? "")?.status === "online";
}

/**
 * Automatic, the auto statuses, then the host's custom statuses; the shown status is ticked.
 *
 * Choosing a status records the derived bucket as its baseline, so the choice holds until Paseo's
 * own reading of the workspace changes. The menu stays open until the host confirms, so a failure
 * can be said where it happened.
 */
function WorkspaceStatusPickerPage({
  workspace,
}: {
  workspace: SidebarWorkspaceEntry;
}): ReactElement {
  const { t } = useTranslation();
  const menu = useMenuContext("WorkspaceStatusPickerPage");
  const catalogs = useWorkspaceStatusCatalogs();
  const host = useWorkspaceStatusHost(workspace.serverId);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offline = host?.status !== "online";

  const derived = derivePrStatusBucket(workspace);
  const effective = resolveEffectivePrStatus(workspace, catalogs);
  const effectiveId = effective.kind === "auto" ? effective.bucket : effective.status.id;
  const manual = workspace.manualStatus;
  const selectedId =
    manual && manual.baseline === derived && manual.statusId === effectiveId
      ? effectiveId
      : AUTOMATIC_ID;

  const choose = useCallback(
    (id: string) => {
      if (pendingId) return;
      const manualStatus: WorkspaceManualStatus | null =
        id === AUTOMATIC_ID ? null : { statusId: id, baseline: derived };
      setPendingId(id);
      setError(null);
      workspaceStatuses
        .setManualStatus({
          serverId: workspace.serverId,
          workspaceId: workspace.workspaceId,
          manualStatus,
        })
        .then(() => menu.setOpen(false))
        .catch(() => setError(t("workspaceStatuses.errors.update")))
        .finally(() => setPendingId(null));
    },
    [derived, menu, pendingId, t, workspace.serverId, workspace.workspaceId],
  );

  const customStatuses = catalogs[workspace.serverId] ?? [];
  return (
    <>
      <WorkspaceStatusRow
        id={AUTOMATIC_ID}
        label={t("workspaceStatuses.automatic")}
        selected={selectedId === AUTOMATIC_ID}
        pending={pendingId === AUTOMATIC_ID}
        disabled={offline}
        onChoose={choose}
      />
      <MenuSeparator />
      {PR_STATUS_BUCKET_ORDER.map((bucket) => (
        <WorkspaceStatusRow
          key={bucket}
          id={bucket}
          label={getPrStatusBucketLabel(bucket, t)}
          selected={selectedId === bucket}
          pending={pendingId === bucket}
          disabled={offline}
          onChoose={choose}
        />
      ))}
      {customStatuses.length > 0 ? <MenuSeparator /> : null}
      {customStatuses.map((status) => (
        <WorkspaceStatusRow
          key={status.id}
          id={status.id}
          label={status.name}
          color={status.color}
          selected={selectedId === status.id}
          pending={pendingId === status.id}
          disabled={offline}
          onChoose={choose}
        />
      ))}
      {error ? <MenuHint testID="workspace-status-picker-error">{error}</MenuHint> : null}
    </>
  );
}

function WorkspaceStatusRow({
  id,
  label,
  color,
  selected,
  pending,
  disabled,
  onChoose,
}: {
  id: string;
  label: string;
  color?: WorkspaceStatusDefinition["color"];
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  onChoose: (id: string) => void;
}): ReactElement {
  const select = useCallback(() => onChoose(id), [id, onChoose]);
  const leading = useMemo(() => (color ? <WorkspaceLabelDot color={color} /> : undefined), [color]);
  return (
    <MenuItem
      leading={leading}
      selected={selected}
      disabled={disabled}
      status={pending ? "pending" : "idle"}
      closeOnSelect={false}
      onSelect={select}
      testID={`workspace-status-picker-row-${id}`}
    >
      {label}
    </MenuItem>
  );
}
