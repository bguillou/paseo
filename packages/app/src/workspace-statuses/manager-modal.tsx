import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { Pencil } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { WorkspaceStatusDefinition } from "@getpaseo/protocol/messages";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { HostFilter } from "@/components/hosts/host-filter";
import { Button } from "@/components/ui/button";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { WorkspaceLabelDot, WorkspaceLabelSwatchRow } from "@/workspace-labels/swatch";
import { useWorkspaceStatuses, workspaceStatuses } from "@/workspace-statuses";
import { WorkspaceStatusManagerModel, type WorkspaceStatusManagerDraft } from "./manager-model";

/** The size the host pill's own glyphs use, so the row's trailing mark matches the controls above it. */
const EDIT_ICON_SIZE = 14;

/** Grows the pencil to a 44pt target without moving it off the trailing rail. */
const EDIT_HIT_SLOP = (44 - EDIT_ICON_SIZE) / 2;

const ThemedPencil = withUnistyles(Pencil);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * One host's custom statuses: the list, and a create/edit view reached the way the label manager
 * reaches its edit view, with the header's back arrow returning to the list.
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
          <View style={styles.list}>
            {state.statuses.map((status) => (
              <WorkspaceStatusManagerRow
                key={status.id}
                status={status}
                disabled={disabled}
                onEdit={edit}
              />
            ))}
            {state.statuses.length === 0 ? (
              <Text style={styles.muted}>{t("workspaceStatuses.manage.empty")}</Text>
            ) : null}
          </View>
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

/** Hover on the plain outer `View`, press on the inner `Pressable` — docs/hover.md. */
function WorkspaceStatusManagerRow({
  status,
  disabled,
  onEdit,
}: {
  status: WorkspaceStatusDefinition;
  disabled: boolean;
  onEdit: (status: WorkspaceStatusDefinition) => void;
}): ReactElement {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [isHovered, setIsHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const edit = useCallback(() => onEdit(status), [status, onEdit]);
  const revealed = isHovered || isNative || isCompact;
  const editStyle = useCallback(
    ({ pressed }: PressableStateCallbackType) => [
      styles.rowEdit,
      !revealed && styles.rowEditHidden,
      pressed && styles.rowEditPressed,
    ],
    [revealed],
  );

  return (
    <View
      style={styles.row}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      testID={`workspace-status-manager-status-${status.id}`}
    >
      <WorkspaceLabelDot color={status.color} />
      <Text style={styles.rowName} numberOfLines={1}>
        {status.name}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("workspaceStatuses.manage.editStatus", { name: status.name })}
        disabled={disabled}
        hitSlop={EDIT_HIT_SLOP}
        onPress={edit}
        pointerEvents={revealed ? "auto" : "none"}
        style={editStyle}
        testID={`workspace-status-manager-edit-${status.id}`}
      >
        <ThemedPencil size={EDIT_ICON_SIZE} uniProps={mutedMapping} />
      </Pressable>
    </View>
  );
}

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
  list: {
    gap: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 32,
  },
  rowName: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  rowEdit: {
    alignItems: "center",
    justifyContent: "center",
  },
  rowEditHidden: {
    opacity: 0,
  },
  rowEditPressed: {
    opacity: 0.6,
  },
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
