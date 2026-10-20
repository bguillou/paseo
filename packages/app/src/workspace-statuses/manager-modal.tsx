import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { WorkspaceStatusDefinition } from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { HostFilter } from "@/components/hosts/host-filter";
import { Button } from "@/components/ui/button";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { moveBoardColumn } from "@/kanban/model";
import { useBoardColumnOrderStore } from "@/kanban/column-order-store";
import { useHosts } from "@/runtime/host-runtime";
import { confirmDialog } from "@/utils/confirm-dialog";
import { WorkspaceLabelSwatchRow } from "@/workspace-labels/swatch";
import {
  useWorkspaceStatusCatalogs,
  useWorkspaceStatuses,
  workspaceStatuses,
} from "@/workspace-statuses";
import { WorkspaceStatusManagerList } from "./manager-list";
import {
  buildWorkspaceStatusManagerEntries,
  reorderWorkspaceStatuses,
  WorkspaceStatusManagerModel,
  type WorkspaceStatusManagerDraft,
} from "./manager-model";
import type { WorkspaceStatusMoveDirection } from "./manager-row";

/**
 * One host's statuses, automatic ones included, in the order the sidebar and kanban show them:
 * the list, and a create/edit view reached the way the label manager reaches its edit view, with
 * the header's back arrow returning to the list.
 */
export function WorkspaceStatusManagerModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const statusHosts = useWorkspaceStatuses((state) => state.hosts);
  const catalogs = useWorkspaceStatusCatalogs();
  const statusOrder = useBoardColumnOrderStore((state) => state.columnOrder);
  const setStatusOrder = useBoardColumnOrderStore((state) => state.setColumnOrder);
  const [model] = useState(
    () =>
      new WorkspaceStatusManagerModel({
        create: (input) => workspaceStatuses.create(input),
        update: (input) => workspaceStatuses.update(input),
        delete: (input) => workspaceStatuses.delete(input),
      }),
  );

  useEffect(() => {
    // Closing ends the edit, so reopening lands on the list.
    if (!visible) {
      model.reset();
      return;
    }
    model.syncHosts(
      hosts.map((host) => ({
        serverId: host.serverId,
        label: host.label || host.serverId,
        status: statusHosts[host.serverId]?.status ?? "offline",
        statuses: statusHosts[host.serverId]?.statuses ?? [],
        error: statusHosts[host.serverId]?.error ?? null,
      })),
    );
  }, [hosts, model, statusHosts, visible]);
  const state = useSyncExternalStore(model.subscribe, model.snapshot, model.snapshot);
  const draft = state.draft;
  const disabled = state.host?.status !== "online" || state.pending;

  const selectHost = useCallback((serverId: string) => model.selectHost(serverId), [model]);
  const startCreate = useCallback(() => model.startCreate(), [model]);
  const edit = useCallback((status: WorkspaceStatusDefinition) => model.edit(status), [model]);
  const entries = useMemo(
    () => buildWorkspaceStatusManagerEntries(state.statuses, statusOrder, t),
    [state.statuses, statusOrder, t],
  );
  const reorder = useCallback(
    (ids: string[]) => setStatusOrder(reorderWorkspaceStatuses({ catalogs, statusOrder, ids, t })),
    [catalogs, setStatusOrder, statusOrder, t],
  );
  const move = useCallback(
    (id: string, direction: WorkspaceStatusMoveDirection) =>
      reorder(
        moveBoardColumn(
          entries.map((entry) => entry.id),
          id,
          direction === "up" ? "left" : "right",
        ),
      ),
    [entries, reorder],
  );
  const cancelEdit = useCallback(() => model.cancelEdit(), [model]);
  const setDraftName = useCallback((value: string) => model.setDraftName(value), [model]);
  const setDraftColor = useCallback(
    (color: WorkspaceStatusDefinition["color"]) => model.setDraftColor(color),
    [model],
  );
  const save = useCallback(() => {
    void model.save();
  }, [model]);
  const remove = useCallback((): void => {
    if (draft?.mode !== "edit") return;
    void model.delete(() =>
      confirmDialog({
        title: t("workspaceStatuses.manage.deleteTitle", { name: draft.original.name }),
        message: t("workspaceStatuses.manage.deleteMessage"),
        confirmLabel: t("workspaceStatuses.manage.delete"),
        destructive: true,
      }),
    );
  }, [draft, model, t]);

  const header = useMemo<SheetHeader>(() => {
    if (!draft) return { title: t("workspaceStatuses.manage.title") };
    return {
      title:
        draft.mode === "create"
          ? t("workspaceStatuses.manage.create")
          : t("workspaceStatuses.manage.edit"),
      back: { onPress: cancelEdit },
    };
  }, [cancelEdit, draft, t]);
  const footer = useMemo(() => {
    if (!draft) {
      return (
        <View style={styles.footer}>
          <Button
            size="md"
            variant="outline"
            disabled={disabled}
            onPress={startCreate}
            testID="workspace-status-manager-create"
          >
            {t("workspaceStatuses.manage.create")}
          </Button>
        </View>
      );
    }
    return (
      <View style={styles.footer}>
        {draft.mode === "edit" ? (
          <Button
            // Red belongs to the confirm dialog, not to the surface that opens it — docs/design.md.
            variant="outline"
            size="md"
            disabled={disabled}
            onPress={remove}
            testID="workspace-status-manager-delete"
          >
            {t("workspaceStatuses.manage.delete")}
          </Button>
        ) : (
          <View />
        )}
        <Button
          size="md"
          style={styles.saveButton}
          disabled={!state.canSave}
          loading={state.pending}
          onPress={save}
          testID="workspace-status-manager-save"
        >
          {t("workspaceStatuses.manage.save")}
        </Button>
      </View>
    );
  }, [disabled, draft, remove, save, startCreate, state.canSave, state.pending, t]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      footer={footer}
      testID="workspace-status-manager"
    >
      {draft ? (
        <WorkspaceStatusEditView
          draft={draft}
          disabled={disabled}
          error={state.error}
          onChangeName={setDraftName}
          onChangeColor={setDraftColor}
          onSubmit={save}
        />
      ) : (
        <>
          {hosts.length > 1 ? (
            <HostFilter
              hosts={hosts}
              selectedHost={state.serverId ?? ""}
              onSelectHost={selectHost}
              includeAllHost={false}
              triggerTestID="workspace-status-manager-host"
              hostOptionTestID={managerHostOptionTestID}
            />
          ) : null}
          <WorkspaceStatusManagerList
            entries={entries}
            disabled={disabled}
            onEdit={edit}
            onMove={move}
            onReorder={reorder}
          />
          {state.host?.status === "offline" ? (
            <Text style={styles.muted}>{t("workspaceStatuses.manage.offline")}</Text>
          ) : null}
          {state.host?.status === "unsupported" ? (
            <Text style={styles.muted}>{t("workspaceStatuses.manage.updateHost")}</Text>
          ) : null}
          {(state.error ?? state.host?.error) ? (
            <Text style={styles.error} testID="workspace-status-manager-error">
              {state.error ?? state.host?.error}
            </Text>
          ) : null}
        </>
      )}
    </AdaptiveModalSheet>
  );
}

const managerHostOptionTestID = (serverId: string) => `workspace-status-manager-host-${serverId}`;

function WorkspaceStatusEditView({
  draft,
  disabled,
  error,
  onChangeName,
  onChangeColor,
  onSubmit,
}: {
  draft: WorkspaceStatusManagerDraft;
  disabled: boolean;
  error: string | null;
  onChangeName: (value: string) => void;
  onChangeColor: (color: WorkspaceStatusDefinition["color"]) => void;
  onSubmit: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const size: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const resetKey = draft.mode === "edit" ? draft.original.id : "create";
  return (
    <>
      <Field label={t("workspaceStatuses.manage.name")}>
        <FormTextInput
          size={size}
          initialValue={draft.name}
          resetKey={resetKey}
          onChangeText={onChangeName}
          onSubmitEditing={onSubmit}
          editable={!disabled}
          autoFocus={draft.mode === "create"}
          autoCorrect={false}
          accessibilityLabel={t("workspaceStatuses.manage.name")}
          testID="workspace-status-manager-name"
        />
      </Field>
      <Field label={t("workspaceStatuses.manage.color")}>
        <WorkspaceLabelSwatchRow
          value={draft.color}
          onChange={onChangeColor}
          disabled={disabled}
          testID="workspace-status-manager-colors"
        />
      </Field>
      {error ? (
        <Text style={styles.error} testID="workspace-status-manager-error">
          {error}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  saveButton: {
    minWidth: 112,
  },
}));
