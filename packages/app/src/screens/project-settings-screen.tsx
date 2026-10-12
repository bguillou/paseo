import { useCallback, useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet } from "react-native-unistyles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MoreVertical, Pencil, Plus } from "lucide-react-native";
import { ProjectIconView } from "@/components/project-icon-view";
import type {
  PaseoConfigRaw,
  PaseoConfigRevision,
  ProjectConfigRpcError,
  ProjectConfigTarget,
} from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert } from "@/components/ui/alert";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ExternalLink } from "@/components/ui/external-link";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { Switch } from "@/components/ui/switch";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { ProjectEditSheet } from "@/components/project-edit-sheet";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { SettingsTextAreaCard } from "@/components/settings-textarea";
import { SettingsGroup } from "@/components/settings/headings/settings-group";
import { SettingsSection } from "@/components/settings/headings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useProjects } from "@/hooks/use-projects";
import type { ProjectEditFormSnapshot } from "@/projects/edit-form";
import { useProjectIcons } from "@/projects/icons";
import { createProjectIconTarget } from "@/projects/icon-target";
import { useHostRuntimeClient, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useToast } from "@/contexts/toast-context";
import { confirmDialog } from "@/utils/confirm-dialog";
import {
  applyDraftToConfig,
  configToDraft,
  METADATA_PROMPT_KEYS,
  type LifecycleOriginalKind,
  type MetadataPromptKey,
  type ProjectConfigDraft,
  type ProjectScriptDraft,
} from "@/utils/project-config-form";
import {
  getProjectHostEntry,
  getProjectSummaryForHostProject,
  type ProjectHostEntry,
  type ProjectSummary,
} from "@/utils/projects";

const SCRIPT_SERVICE_TYPE = "service";

const ICON_SIZE = 14;

interface MetadataPromptField {
  titleKey: string;
  placeholderKey: string;
  sectionTestID: string;
  inputTestID: string;
}

const METADATA_PROMPT_FIELDS: Record<MetadataPromptKey, MetadataPromptField> = {
  branchName: {
    titleKey: "settings.project.metadata.branchName",
    placeholderKey: "settings.project.metadata.branchNamePlaceholder",
    sectionTestID: "metadata-prompt-branch-name-section",
    inputTestID: "metadata-prompt-branch-name-input",
  },
  commitMessage: {
    titleKey: "settings.project.metadata.commitMessage",
    placeholderKey: "settings.project.metadata.commitMessagePlaceholder",
    sectionTestID: "metadata-prompt-commit-message-section",
    inputTestID: "metadata-prompt-commit-message-input",
  },
  pullRequest: {
    titleKey: "settings.project.metadata.pullRequest",
    placeholderKey: "settings.project.metadata.pullRequestPlaceholder",
    sectionTestID: "metadata-prompt-pull-request-section",
    inputTestID: "metadata-prompt-pull-request-input",
  },
};

const WORKTREE_DOCS_URL = "https://paseo.sh/docs/worktrees";

type ReadProjectConfigData = Awaited<ReturnType<DaemonClient["readProjectConfig"]>>;

export interface ProjectSettingsScreenProps {
  serverId: string;
  projectId: string;
  onBackToProjects: () => void;
  showBackToProjects: boolean;
}

export default function ProjectSettingsScreen({
  serverId,
  projectId,
  onBackToProjects,
  showBackToProjects,
}: ProjectSettingsScreenProps) {
  const { projects } = useProjects();
  const project = useMemo(
    () => getProjectSummaryForHostProject(projects, serverId, projectId),
    [projectId, projects, serverId],
  );
  const selectedHost = getProjectHostEntry(project, serverId, projectId);
  const selectedSnapshot = useHostRuntimeSnapshot(serverId);
  const isHostGone =
    Boolean(serverId) &&
    (selectedSnapshot?.connectionStatus === "offline" ||
      selectedSnapshot?.connectionStatus === "error");

  const client = useHostRuntimeClient(serverId);
  const canEdit =
    selectedHost?.isOnline === true &&
    selectedHost.serverId.trim().length > 0 &&
    selectedHost.repoRoot.trim().length > 0;

  if (!project || !selectedHost || !client || !canEdit) {
    return (
      <NoEditableTarget
        onBackToProjects={onBackToProjects}
        showBackToProjects={showBackToProjects}
      />
    );
  }

  return (
    <ProjectSettingsBody
      project={project}
      selectedHost={selectedHost}
      client={client}
      isHostGone={isHostGone}
      onBackToProjects={onBackToProjects}
      showBackToProjects={showBackToProjects}
    />
  );
}

function NoEditableTarget({
  onBackToProjects,
  showBackToProjects,
}: {
  onBackToProjects: () => void;
  showBackToProjects: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.noTargetContainer}>
      {showBackToProjects ? <BackToProjectsButton onPress={onBackToProjects} /> : null}
      <Text style={styles.noTargetText}>{t("settings.project.noEditableTarget")}</Text>
      {showBackToProjects ? (
        <Button
          testID="project-settings-back-button"
          onPress={onBackToProjects}
          variant="secondary"
          size="md"
        >
          {t("settings.project.backToProjects")}
        </Button>
      ) : null}
    </View>
  );
}

function BackToProjectsButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Button
      testID="project-settings-back-link"
      accessibilityLabel={t("settings.project.backToProjects")}
      onPress={onPress}
      variant="ghost"
      size="sm"
      leftIcon={ArrowLeft}
      style={styles.backButton}
    >
      {t("settings.project.backToProjects")}
    </Button>
  );
}

interface ProjectSettingsBodyProps {
  project: ProjectSummary;
  selectedHost: ProjectHostEntry;
  client: DaemonClient;
  isHostGone: boolean;
  onBackToProjects: () => void;
  showBackToProjects: boolean;
}

function ProjectSettingsBody({
  project,
  selectedHost,
  client,
  isHostGone,
  onBackToProjects,
  showBackToProjects,
}: ProjectSettingsBodyProps) {
  const { t } = useTranslation();
  const [isEditSheetOpen, setIsEditSheetOpen] = useState(false);
  const [editSessionId, setEditSessionId] = useState(0);
  const openEditSheet = useCallback(() => {
    setEditSessionId((id) => id + 1);
    setIsEditSheetOpen(true);
  }, []);
  const closeEditSheet = useCallback(() => setIsEditSheetOpen(false), []);

  const supportsGlobalConfig = useHostFeature(selectedHost.serverId, "projectGlobalConfig");
  const [source, setSource] = useState<ProjectConfigTarget>("project_file");
  // A host that can't store a global config only ever edits the committed file.
  const effectiveSource: ProjectConfigTarget = supportsGlobalConfig ? source : "project_file";
  const otherSource: ProjectConfigTarget =
    effectiveSource === "project_file" ? "global" : "project_file";

  const queryKey = useMemo(
    () =>
      ["project-config", selectedHost.serverId, selectedHost.repoRoot, effectiveSource] as const,
    [selectedHost.serverId, selectedHost.repoRoot, effectiveSource],
  );

  const readQuery = useQuery({
    queryKey,
    queryFn: () => client.readProjectConfig(selectedHost.repoRoot, { source: effectiveSource }),
    retry: false,
  });

  // Probe the opposite layer so the UI can warn before overwriting it and can
  // tell the user a committed file still shadows the global config.
  const otherLayerQuery = useQuery({
    queryKey: [
      "project-config",
      selectedHost.serverId,
      selectedHost.repoRoot,
      otherSource,
    ] as const,
    queryFn: () => client.readProjectConfig(selectedHost.repoRoot, { source: otherSource }),
    retry: false,
    enabled: supportsGlobalConfig,
  });
  const otherLayerExists =
    otherLayerQuery.data?.ok === true && otherLayerQuery.data.revision !== null;

  const refetchProjectConfig = readQuery.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchProjectConfig();
    }, [refetchProjectConfig]),
  );

  const data = readQuery.data;
  const supportsCustomIcon = useHostFeature(selectedHost.serverId, "projectCustomIcon");
  const customIconRevision = selectedHost.customIconRevision ?? null;
  const projectIconTargets = useMemo(() => {
    const target = createProjectIconTarget({
      projectViewKey: project.viewKey,
      placement: { ...selectedHost, iconWorkingDir: selectedHost.repoRoot },
    });
    return target ? [target] : [];
  }, [project.viewKey, selectedHost]);
  const projectIcons = useProjectIcons({ projects: projectIconTargets });
  const projectIconDataUri = projectIcons.get(project.viewKey) ?? null;
  const editSnapshot = useMemo<ProjectEditFormSnapshot>(
    () => ({
      projectName: selectedHost.projectName,
      projectCustomName: selectedHost.projectCustomName,
      hasCustomIcon: customIconRevision !== null,
      currentIconDataUri: projectIconDataUri,
    }),
    [
      customIconRevision,
      projectIconDataUri,
      selectedHost.projectCustomName,
      selectedHost.projectName,
    ],
  );
  const loadedConfig: PaseoConfigRaw | null = data?.ok ? (data.config ?? {}) : null;
  const loadedRevision: PaseoConfigRevision | null = data?.ok ? data.revision : null;
  const hasUncommittedWorktreeSetupChanges =
    data?.ok === true && data.hasUncommittedWorktreeSetupChanges === true;
  const readError: ProjectConfigRpcError | null = data && !data.ok ? data.error : null;

  const handleReload = useCallback(() => {
    void readQuery.refetch();
  }, [readQuery]);

  return (
    <View role="main" style={styles.body}>
      {showBackToProjects ? <BackToProjectsButton onPress={onBackToProjects} /> : null}

      <View style={styles.headerBlock}>
        <View style={styles.titleRow}>
          <ProjectTitleIcon
            iconDataUri={projectIconDataUri}
            projectName={selectedHost.projectName}
            projectViewKey={project.viewKey}
          />
          <Text style={styles.projectTitle} numberOfLines={1}>
            {selectedHost.projectName}
          </Text>
          <Pressable
            testID="project-edit-button"
            accessibilityRole="button"
            accessibilityLabel={t("settings.project.edit.title")}
            onPress={openEditSheet}
            hitSlop={8}
            style={styles.editButton}
          >
            <Pencil size={ICON_SIZE} color={styles.iconColor.color} />
          </Pressable>
        </View>
      </View>

      <ProjectEditSheet
        // A new instance per open seeds the form from the project as it stands now.
        key={`${selectedHost.serverId}:${selectedHost.projectId}:${editSessionId}`}
        visible={isEditSheetOpen}
        onClose={closeEditSheet}
        serverId={selectedHost.serverId}
        projectId={selectedHost.projectId}
        projectViewKey={project.viewKey}
        client={client}
        supportsCustomIcon={supportsCustomIcon}
        snapshot={editSnapshot}
      />

      {supportsGlobalConfig ? (
        <View style={styles.sourceSelectorRow}>
          <Text style={styles.sourceSelectorLabel}>{t("settings.project.source.label")}</Text>
          <SegmentedControl<ProjectConfigTarget>
            size="sm"
            testID="config-source-selector"
            value={effectiveSource}
            onValueChange={setSource}
            options={[
              {
                value: "project_file",
                label: t("settings.project.source.projectFile"),
                testID: "config-source-project",
              },
              {
                value: "global",
                label: t("settings.project.source.global"),
                testID: "config-source-global",
              },
            ]}
          />
        </View>
      ) : null}

      {renderContent({
        readQuery,
        loadedConfig,
        loadedRevision,
        hasUncommittedWorktreeSetupChanges,
        readError,
        selectedHost,
        queryKey,
        client,
        onReload: handleReload,
        isHostGone,
        onBackToProjects,
        showBackToProjects,
        source: effectiveSource,
        onSwitchSource: setSource,
        otherLayerExists,
        supportsGlobalConfig,
      })}
    </View>
  );
}

interface RenderContentInput {
  readQuery: ReturnType<typeof useQuery<ReadProjectConfigData>>;
  loadedConfig: PaseoConfigRaw | null;
  loadedRevision: PaseoConfigRevision | null;
  hasUncommittedWorktreeSetupChanges: boolean;
  readError: ProjectConfigRpcError | null;
  selectedHost: ProjectHostEntry;
  queryKey: readonly [string, string, string, ProjectConfigTarget];
  client: DaemonClient;
  onReload: () => void;
  isHostGone: boolean;
  onBackToProjects: () => void;
  showBackToProjects: boolean;
  source: ProjectConfigTarget;
  onSwitchSource: (next: ProjectConfigTarget) => void;
  otherLayerExists: boolean;
  supportsGlobalConfig: boolean;
}

function renderContent({
  readQuery,
  loadedConfig,
  loadedRevision,
  hasUncommittedWorktreeSetupChanges,
  readError,
  selectedHost,
  queryKey,
  client,
  onReload,
  isHostGone,
  onBackToProjects,
  showBackToProjects,
  source,
  onSwitchSource,
  otherLayerExists,
  supportsGlobalConfig,
}: RenderContentInput) {
  if (readQuery.isLoading) {
    return (
      <View style={styles.centered}>
        <LoadingSpinner color={ResolveSpinnerColor()} />
      </View>
    );
  }

  if (readQuery.isError) {
    return <ReadFailureCallout kind="transport" error={readQuery.error} onReload={onReload} />;
  }

  if (readError) {
    return <ReadFailureCallout kind={readError.code} error={null} onReload={onReload} />;
  }

  if (isHostGone) {
    return (
      <NoEditableTarget
        onBackToProjects={onBackToProjects}
        showBackToProjects={showBackToProjects}
      />
    );
  }

  if (!loadedConfig) {
    return (
      <View style={styles.centered}>
        <LoadingSpinner color={ResolveSpinnerColor()} />
      </View>
    );
  }

  const formKey = `${selectedHost.serverId}::${selectedHost.repoRoot}::${source}::${revisionToKey(loadedRevision)}`;
  return (
    <ProjectConfigForm
      key={formKey}
      baseConfig={loadedConfig}
      revision={loadedRevision}
      hasUncommittedWorktreeSetupChanges={hasUncommittedWorktreeSetupChanges}
      repoRoot={selectedHost.repoRoot}
      queryKey={queryKey}
      client={client}
      onReload={onReload}
      source={source}
      onSwitchSource={onSwitchSource}
      otherLayerExists={otherLayerExists}
      supportsGlobalConfig={supportsGlobalConfig}
    />
  );
}

function revisionToKey(revision: PaseoConfigRevision | null): string {
  if (!revision) return "none";
  return `${revision.mtimeMs}-${revision.size}`;
}

interface ReadFailureCalloutProps {
  kind: "transport" | ProjectConfigRpcError["code"];
  error: unknown;
  onReload: () => void;
}

function ReadFailureCallout({ kind, error, onReload }: ReadFailureCalloutProps) {
  const { t } = useTranslation();
  const { testID, title, description } = resolveReadFailureCopy({
    kind,
    error,
    t,
  });
  return (
    <View style={styles.errorBlock}>
      <Alert size="md" testID={testID} variant="error" title={title} description={description}>
        <Button testID={`${testID}-action-0`} onPress={onReload} variant="outline" size="sm">
          {t("settings.project.actions.reload")}
        </Button>
      </Alert>
    </View>
  );
}

function resolveReadFailureCopy(input: {
  kind: ReadFailureCalloutProps["kind"];
  error: unknown;
  t: TFunction;
}): { testID: string; title: string; description: string } {
  if (input.kind === "invalid_project_config") {
    return {
      testID: "invalid-callout",
      title: input.t("settings.project.readFailures.invalidTitle"),
      description: input.t("settings.project.readFailures.invalidDescription"),
    };
  }
  if (input.kind === "project_not_found") {
    return {
      testID: "project-not-found-callout",
      title: input.t("settings.project.readFailures.missingTitle"),
      description: input.t("settings.project.readFailures.missingSingleHost"),
    };
  }
  if (input.kind === "transport") {
    const detail = errorToDetail(input.error);
    return {
      testID: "read-transport-callout",
      title: input.t("settings.project.readFailures.transportTitle"),
      description: detail ?? input.t("settings.project.readFailures.transportFallback"),
    };
  }
  return {
    testID: "read-failed-callout",
    title: input.t("settings.project.readFailures.failedTitle"),
    description: input.t("settings.project.readFailures.failedDescription"),
  };
}

function errorToDetail(error: unknown): string | null {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return null;
}

interface ProjectConfigFormProps {
  baseConfig: PaseoConfigRaw;
  revision: PaseoConfigRevision | null;
  hasUncommittedWorktreeSetupChanges: boolean;
  repoRoot: string;
  queryKey: readonly [string, string, string, ProjectConfigTarget];
  client: DaemonClient;
  onReload: () => void;
  source: ProjectConfigTarget;
  onSwitchSource: (next: ProjectConfigTarget) => void;
  otherLayerExists: boolean;
  supportsGlobalConfig: boolean;
}

function ProjectConfigForm({
  baseConfig,
  revision,
  hasUncommittedWorktreeSetupChanges,
  repoRoot,
  queryKey,
  client,
  onReload,
  source,
  onSwitchSource,
  otherLayerExists,
  supportsGlobalConfig,
}: ProjectConfigFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();
  // Prefix key (host + repo) so invalidation refreshes both layers at once.
  const projectConfigPrefix = useMemo(
    () => [queryKey[0], queryKey[1], queryKey[2]] as const,
    [queryKey],
  );

  const [draft, setDraft] = useState<ProjectConfigDraft>(() => configToDraft(baseConfig));
  const [writeError, setWriteError] = useState<ProjectConfigRpcError | null>(null);
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (input: {
      config: PaseoConfigRaw;
      expectedRevision: PaseoConfigRevision | null;
    }) => {
      return client.writeProjectConfig({
        repoRoot,
        config: input.config,
        expectedRevision: input.expectedRevision,
        target: source,
      });
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData<ReadProjectConfigData>(queryKey, {
          ok: true,
          config: result.config,
          revision: result.revision,
          requestId: "local-cache",
          repoRoot,
          ...(result.hasUncommittedWorktreeSetupChanges === undefined
            ? {}
            : {
                hasUncommittedWorktreeSetupChanges: result.hasUncommittedWorktreeSetupChanges,
              }),
        });
        setWriteError(null);
        // The effective config may change for either layer, so refresh both.
        queryClient.invalidateQueries({ queryKey: projectConfigPrefix });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        toast.show(t("settings.project.actions.saved"), { variant: "success" });
      } else {
        setWriteError(result.error);
      }
    },
  });

  const offerDeleteCommittedFile = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("settings.project.delete.confirmTitle"),
      message: t("settings.project.delete.confirmMessage"),
      confirmLabel: t("settings.project.delete.confirm"),
      cancelLabel: t("settings.project.actions.cancel"),
      destructive: true,
    });
    if (!confirmed) return;
    const result = await client.deleteProjectConfigFile({ repoRoot });
    if (result.ok) {
      queryClient.invalidateQueries({ queryKey: projectConfigPrefix });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.show(t("settings.project.delete.deleted"), { variant: "success" });
    } else {
      toast.show(t("settings.project.delete.failed"), { variant: "error" });
    }
  }, [client, repoRoot, queryClient, projectConfigPrefix, toast, t]);

  const migrateMutation = useMutation({
    mutationFn: async () => client.migrateProjectConfigToGlobal({ repoRoot }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.show(t("settings.project.migrate.failedTitle"), { variant: "error" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: projectConfigPrefix });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.show(t("settings.project.migrate.moved"), { variant: "success" });
      onSwitchSource("global");
      // The committed file still wins until it is removed, so offer that next.
      void offerDeleteCommittedFile();
    },
    onError: () => {
      toast.show(t("settings.project.migrate.failedTitle"), { variant: "error" });
    },
  });

  const handleMigrateToGlobal = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t("settings.project.migrate.confirmTitle"),
      message: otherLayerExists
        ? t("settings.project.migrate.confirmOverwriteMessage")
        : t("settings.project.migrate.confirmMessage"),
      confirmLabel: t("settings.project.actions.moveToGlobal"),
      cancelLabel: t("settings.project.actions.cancel"),
      destructive: otherLayerExists,
    });
    if (!confirmed) return;
    migrateMutation.mutate();
  }, [t, otherLayerExists, migrateMutation]);

  const handleSave = useCallback(() => {
    if (writeError?.code === "stale_project_config") return;
    const config = applyDraftToConfig({ draft, base: baseConfig });
    saveMutation.mutate({ config, expectedRevision: revision });
  }, [draft, baseConfig, revision, writeError, saveMutation]);

  const handleReload = useCallback(() => {
    setWriteError(null);
    onReload();
  }, [onReload]);

  const updateDraft = useCallback((updater: (draft: ProjectConfigDraft) => ProjectConfigDraft) => {
    setDraft((prev) => updater(prev));
  }, []);

  const handleSetupChange = useCallback(
    (text: string) => updateDraft((d) => ({ ...d, setupText: text })),
    [updateDraft],
  );
  const handleTeardownChange = useCallback(
    (text: string) => updateDraft((d) => ({ ...d, teardownText: text })),
    [updateDraft],
  );

  const handleMetadataPromptChange = useCallback(
    (key: MetadataPromptKey, text: string) =>
      updateDraft((d) => ({
        ...d,
        metadataPrompts: { ...d.metadataPrompts, [key]: text },
      })),
    [updateDraft],
  );

  const handleRemoveScript = useCallback(
    async (script: ProjectScriptDraft) => {
      const ok = await confirmDialog({
        title: t("settings.project.scripts.removeTitle"),
        message: t("settings.project.scripts.removeMessage", {
          name: script.name || t("settings.project.scripts.removeFallbackName"),
        }),
        confirmLabel: t("settings.project.scripts.actions.remove"),
        cancelLabel: t("settings.project.actions.cancel"),
        destructive: true,
      });
      if (!ok) return;
      updateDraft((d) => ({
        ...d,
        scripts: d.scripts.filter((entry) => entry.id !== script.id),
      }));
    },
    [t, updateDraft],
  );

  const handleEditScript = useCallback((script: ProjectScriptDraft) => {
    setEditingScriptId(script.id);
  }, []);

  const handleAddScript = useCallback(() => {
    const id = `script-draft-new-${Date.now()}`;
    updateDraft((d) => ({
      ...d,
      scripts: [
        ...d.scripts,
        {
          id,
          name: "",
          commandText: "",
          commandOriginalKind: "missing" satisfies LifecycleOriginalKind,
          type: "",
          portText: "",
          previewUrlText: "",
          rawEntry: {},
        },
      ],
    }));
    setEditingScriptId(id);
  }, [updateDraft]);

  const handleEditingDraftChange = useCallback(
    (next: ProjectScriptDraft) => {
      updateDraft((d) => ({
        ...d,
        scripts: d.scripts.map((entry) => (entry.id === next.id ? next : entry)),
      }));
    },
    [updateDraft],
  );

  const handleCancelEditing = useCallback(() => {
    if (!editingScriptId) {
      return;
    }
    updateDraft((d) => {
      const entry = d.scripts.find((row) => row.id === editingScriptId);
      if (!entry) return d;
      const isEmpty =
        entry.name.trim().length === 0 &&
        entry.commandText.trim().length === 0 &&
        entry.type.trim().length === 0 &&
        entry.portText.trim().length === 0;
      if (!isEmpty) return d;
      return { ...d, scripts: d.scripts.filter((row) => row.id !== editingScriptId) };
    });
    setEditingScriptId(null);
  }, [editingScriptId, updateDraft]);

  const handleSaveEditing = useCallback(() => {
    setEditingScriptId(null);
  }, []);

  const editingScript = draft.scripts.find((entry) => entry.id === editingScriptId);

  const hasInvalidScripts = useMemo(
    () => draft.scripts.some((script) => validateScript(script, t).hasErrors),
    [draft.scripts, t],
  );

  const scriptsTrailing = useMemo(
    () => (
      <Pressable
        onPress={handleAddScript}
        hitSlop={8}
        style={settingsStyles.sectionHeaderLink}
        accessibilityRole="button"
        accessibilityLabel={t("settings.project.scripts.actions.add")}
        testID="scripts-add-button"
      >
        <Plus size={ICON_SIZE} color={styles.iconColor.color} />
      </Pressable>
    ),
    [handleAddScript, t],
  );

  const setupDocsLink = useMemo(
    () => (
      <ExternalLink
        href={WORKTREE_DOCS_URL}
        label={t("settings.project.worktree.docs")}
        tooltip={t("settings.project.worktree.docsTooltip")}
        testID="worktree-setup-docs-link"
      />
    ),
    [t],
  );
  const teardownDocsLink = useMemo(
    () => (
      <ExternalLink
        href={WORKTREE_DOCS_URL}
        label={t("settings.project.worktree.docs")}
        tooltip={t("settings.project.worktree.docsTooltip")}
        testID="worktree-teardown-docs-link"
      />
    ),
    [t],
  );

  const isStale = writeError?.code === "stale_project_config";
  const isWriteFailed = writeError?.code === "write_failed";
  const saveDisabled =
    saveMutation.isPending || migrateMutation.isPending || isStale || hasInvalidScripts;
  // Migration copies the committed file into the global layer, so it only makes
  // sense while editing the project file and when a committed file exists.
  const canMigrateToGlobal = supportsGlobalConfig && source === "project_file" && revision !== null;
  // Project file wins at runtime, so a committed file shadows the global config
  // the user is now editing until it is removed.
  const committedFileShadowsGlobal =
    supportsGlobalConfig && source === "global" && otherLayerExists;

  return (
    <View>
      <SettingsGroup
        title={t("settings.project.worktree.title")}
        info={t("settings.project.worktree.info")}
        testID="worktree-group"
      >
        <SettingsSection
          title={t("settings.project.worktree.setup")}
          testID="worktree-setup-section"
          trailing={setupDocsLink}
        >
          {hasUncommittedWorktreeSetupChanges ? (
            <Alert
              size="sm"
              variant="warning"
              title={t("settings.project.worktree.uncommittedTitle")}
              description={t("settings.project.worktree.uncommittedDescription")}
            />
          ) : null}
          <SettingsTextAreaCard
            testID="worktree-setup-input"
            accessibilityLabel={t("settings.project.worktree.setupAccessibility")}
            value={draft.setupText}
            onChangeText={handleSetupChange}
            placeholder="npm install"
          />
        </SettingsSection>

        <SettingsSection
          title={t("settings.project.worktree.teardown")}
          testID="worktree-teardown-section"
          trailing={teardownDocsLink}
          flush
        >
          <SettingsTextAreaCard
            testID="worktree-teardown-input"
            accessibilityLabel={t("settings.project.worktree.teardownAccessibility")}
            value={draft.teardownText}
            onChangeText={handleTeardownChange}
            placeholder="docker compose down"
          />
        </SettingsSection>
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.project.scripts.title")}
        info={t("settings.project.scripts.info")}
        trailing={scriptsTrailing}
        testID="scripts-group"
      >
        <View style={settingsStyles.card} testID="scripts-list">
          {draft.scripts.length === 0 ? (
            <View style={settingsStyles.row}>
              <Text style={styles.emptyScripts}>{t("settings.project.scripts.empty")}</Text>
            </View>
          ) : (
            draft.scripts.map((script, index) => (
              <ScriptRow
                key={script.id}
                script={script}
                isFirst={index === 0}
                onEdit={handleEditScript}
                onRemove={handleRemoveScript}
              />
            ))
          )}
        </View>
      </SettingsGroup>

      <SettingsGroup
        title={t("settings.project.metadata.title")}
        info={t("settings.project.metadata.info")}
        testID="metadata-group"
      >
        {METADATA_PROMPT_KEYS.map((key, index) => (
          <MetadataPromptSection
            key={key}
            promptKey={key}
            value={draft.metadataPrompts[key]}
            onChange={handleMetadataPromptChange}
            flush={index === METADATA_PROMPT_KEYS.length - 1}
          />
        ))}
      </SettingsGroup>

      {isStale ? (
        <View style={styles.calloutWrap}>
          <Alert
            size="sm"
            testID="stale-callout"
            variant="error"
            title={t("settings.project.writeFailures.staleTitle")}
            description={t("settings.project.writeFailures.staleDescription")}
          >
            <Button
              testID="stale-callout-action-0"
              onPress={handleReload}
              variant="outline"
              size="sm"
            >
              {t("settings.project.actions.reload")}
            </Button>
          </Alert>
        </View>
      ) : null}

      {isWriteFailed ? (
        <View style={styles.calloutWrap}>
          <Alert
            size="sm"
            testID="write-failed-callout"
            variant="error"
            title={t("settings.project.writeFailures.failedTitle")}
            description={t("settings.project.writeFailures.failedDescription")}
          >
            <Button
              testID="write-failed-callout-action-0"
              onPress={handleSave}
              variant="outline"
              size="sm"
            >
              {t("settings.project.actions.tryAgain")}
            </Button>
            <Button
              testID="write-failed-callout-action-1"
              onPress={handleReload}
              variant="outline"
              size="sm"
            >
              {t("settings.project.actions.reload")}
            </Button>
          </Alert>
        </View>
      ) : null}

      {committedFileShadowsGlobal ? (
        <View style={styles.calloutWrap}>
          <Alert
            size="sm"
            testID="committed-config-present-alert"
            variant="info"
            title={t("settings.project.migrate.committedStillPresentTitle")}
            description={t("settings.project.migrate.committedStillPresentDescription")}
          >
            <Button
              testID="committed-config-present-action-0"
              onPress={offerDeleteCommittedFile}
              variant="outline"
              size="sm"
            >
              {t("settings.project.delete.confirm")}
            </Button>
          </Alert>
        </View>
      ) : null}

      {canMigrateToGlobal ? (
        <View style={settingsStyles.card} testID="migrate-to-global-card">
          <View style={settingsStyles.row}>
            <View style={styles.migrateRowContent}>
              <Text style={styles.migrateTitle}>{t("settings.project.migrate.title")}</Text>
              <Text style={styles.migrateDescription}>
                {t("settings.project.migrate.description")}
              </Text>
            </View>
            <Button
              testID="migrate-to-global-button"
              accessibilityLabel={t("settings.project.actions.moveToGlobal")}
              variant="outline"
              size="sm"
              disabled={saveMutation.isPending || migrateMutation.isPending}
              loading={migrateMutation.isPending}
              onPress={handleMigrateToGlobal}
            >
              {t("settings.project.actions.moveToGlobal")}
            </Button>
          </View>
        </View>
      ) : null}

      <View style={styles.footer}>
        <Button
          testID="save-button"
          accessibilityLabel={t("settings.project.actions.save")}
          variant="default"
          size="md"
          disabled={saveDisabled}
          loading={saveMutation.isPending}
          onPress={handleSave}
        >
          {saveMutation.isPending
            ? t("settings.project.actions.saving")
            : t("settings.project.actions.save")}
        </Button>
      </View>

      {editingScript ? (
        <ScriptEditModal
          script={editingScript}
          onChange={handleEditingDraftChange}
          onCancel={handleCancelEditing}
          onSave={handleSaveEditing}
        />
      ) : null}
    </View>
  );
}

function ResolveSpinnerColor(): string {
  return styles.spinnerColor.color;
}

function ProjectTitleIcon({
  iconDataUri,
  projectName,
  projectViewKey,
}: {
  iconDataUri: string | null;
  projectName: string;
  projectViewKey: string;
}) {
  const initial = projectName.trim().charAt(0).toUpperCase() || "?";
  return (
    <ProjectIconView
      iconDataUri={iconDataUri}
      initial={initial}
      projectViewKey={projectViewKey}
      size={28}
      textStyle={styles.titleIconFallbackText}
    />
  );
}

interface MetadataPromptSectionProps {
  promptKey: MetadataPromptKey;
  value: string;
  onChange: (key: MetadataPromptKey, text: string) => void;
  flush?: boolean;
}

function MetadataPromptSection({ promptKey, value, onChange, flush }: MetadataPromptSectionProps) {
  const { t } = useTranslation();
  const meta = METADATA_PROMPT_FIELDS[promptKey];
  const title = t(meta.titleKey);
  const handleChange = useCallback(
    (text: string) => onChange(promptKey, text),
    [onChange, promptKey],
  );
  return (
    <SettingsSection title={title} testID={meta.sectionTestID} flush={flush}>
      <SettingsTextAreaCard
        testID={meta.inputTestID}
        accessibilityLabel={title}
        value={value}
        onChangeText={handleChange}
        placeholder={t(meta.placeholderKey)}
      />
    </SettingsSection>
  );
}

interface ScriptRowProps {
  script: ProjectScriptDraft;
  isFirst: boolean;
  onEdit: (script: ProjectScriptDraft) => void;
  onRemove: (script: ProjectScriptDraft) => void;
}

function ScriptRow({ script, isFirst, onEdit, onRemove }: ScriptRowProps) {
  const { t } = useTranslation();
  const handleEdit = useCallback(() => onEdit(script), [onEdit, script]);
  const handleRemove = useCallback(() => onRemove(script), [onRemove, script]);
  const rowStyle = isFirst ? styles.scriptRow : styles.scriptRowWithBorder;

  return (
    <View style={rowStyle} testID={`script-row-${script.id}`}>
      <Pressable style={styles.scriptRowMain} onPress={handleEdit}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {script.name || t("settings.project.scripts.untitled")}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {scriptHint(script, t)}
        </Text>
      </Pressable>
      <DropdownMenu>
        <DropdownMenuTrigger
          accessibilityLabel={t("settings.project.scripts.menuAccessibility")}
          testID={`script-row-menu-${script.id}`}
          style={styles.scriptKebab}
        >
          <MoreVertical size={ICON_SIZE} color={styles.chevronColor.color} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" minWidth={160}>
          <DropdownMenuItem testID={`script-action-${script.id}-edit`} onSelect={handleEdit}>
            {t("settings.project.scripts.actions.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem
            testID={`script-action-${script.id}-remove`}
            destructive
            onSelect={handleRemove}
          >
            {t("settings.project.scripts.actions.remove")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function scriptHint(script: ProjectScriptDraft, t: TFunction): string {
  const pieces: string[] = [];
  if (script.type) pieces.push(script.type);
  if (script.portText) pieces.push(t("settings.project.scripts.port", { port: script.portText }));
  if (script.commandText) pieces.push(script.commandText.split("\n")[0] ?? "");
  return pieces.join(" · ");
}

interface ScriptValidation {
  hasErrors: boolean;
  nameError: string | null;
  commandError: string | null;
}

function validateScript(script: ProjectScriptDraft, t: TFunction): ScriptValidation {
  const nameError =
    script.name.trim().length === 0 ? t("settings.project.scripts.nameRequired") : null;
  const commandError =
    script.commandText.trim().length === 0 ? t("settings.project.scripts.commandRequired") : null;
  return {
    hasErrors: Boolean(nameError || commandError),
    nameError,
    commandError,
  };
}

interface ScriptEditModalProps {
  script: ProjectScriptDraft;
  onChange: (next: ProjectScriptDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}

interface ScriptFieldsTouched {
  name: boolean;
  command: boolean;
}

const ALL_TOUCHED: ScriptFieldsTouched = { name: true, command: true };
const NONE_TOUCHED: ScriptFieldsTouched = { name: false, command: false };

function ScriptEditModal({ script, onChange, onCancel, onSave }: ScriptEditModalProps) {
  const { t } = useTranslation();
  const [touched, setTouched] = useState<ScriptFieldsTouched>(NONE_TOUCHED);

  useEffect(() => {
    setTouched(NONE_TOUCHED);
  }, [script.id]);

  const markTouched = useCallback((field: keyof ScriptFieldsTouched) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }, []);

  const handleNameChange = useCallback(
    (text: string) => onChange({ ...script, name: text }),
    [onChange, script],
  );
  const handleCommandChange = useCallback(
    (text: string) => onChange({ ...script, commandText: text }),
    [onChange, script],
  );
  const handleServiceToggle = useCallback(
    (next: boolean) => onChange({ ...script, type: next ? SCRIPT_SERVICE_TYPE : "" }),
    [onChange, script],
  );
  const handlePreviewUrlChange = useCallback(
    (text: string) => onChange({ ...script, previewUrlText: text }),
    [onChange, script],
  );

  const handleNameBlur = useCallback(() => markTouched("name"), [markTouched]);
  const handleCommandBlur = useCallback(() => markTouched("command"), [markTouched]);

  const validation = validateScript(script, t);

  const handleSavePress = useCallback(() => {
    if (validation.hasErrors) {
      setTouched(ALL_TOUCHED);
      return;
    }
    onSave();
  }, [validation.hasErrors, onSave]);

  const showNameError = touched.name && validation.nameError;
  const showCommandError = touched.command && validation.commandError;
  const isService = script.type === SCRIPT_SERVICE_TYPE;
  const sheetHeader = useMemo<SheetHeader>(
    () => ({
      title: script.name
        ? t("settings.project.scripts.editScript", { name: script.name })
        : t("settings.project.scripts.newScript"),
    }),
    [script.name, t],
  );

  return (
    <AdaptiveModalSheet
      visible
      header={sheetHeader}
      onClose={onCancel}
      testID="script-edit-modal"
      desktopMaxWidth={560}
    >
      <View style={styles.modalSection}>
        <Text style={styles.modalLabel}>{t("settings.project.scripts.name")}</Text>
        <TextInput
          testID="script-edit-name"
          accessibilityLabel={t("settings.project.scripts.nameAccessibility")}
          initialValue={script.name}
          onChangeText={handleNameChange}
          onBlur={handleNameBlur}
          placeholder="dev"
          placeholderTextColor={styles.placeholderColor.color}
          style={styles.modalInput}
        />
        {showNameError ? (
          <Text testID="script-edit-name-error" style={styles.fieldError}>
            {validation.nameError}
          </Text>
        ) : null}
      </View>
      <View style={styles.modalSection}>
        <Text style={styles.modalLabel}>{t("settings.project.scripts.command")}</Text>
        <TextInput
          testID="script-edit-command"
          accessibilityLabel={t("settings.project.scripts.commandAccessibility")}
          multiline
          initialValue={script.commandText}
          onChangeText={handleCommandChange}
          onBlur={handleCommandBlur}
          placeholder="npm run dev"
          placeholderTextColor={styles.placeholderColor.color}
          style={styles.modalMultilineInput}
        />
        {showCommandError ? (
          <Text testID="script-edit-command-error" style={styles.fieldError}>
            {validation.commandError}
          </Text>
        ) : null}
      </View>
      <View style={styles.modalSection}>
        <View style={styles.serviceToggleRow}>
          <View style={styles.serviceToggleText}>
            <Text style={styles.serviceToggleLabel}>
              {t("settings.project.scripts.runAsService")}
            </Text>
            <Text style={styles.modalHint}>{t("settings.project.scripts.serviceHint")}</Text>
          </View>
          <Switch
            value={isService}
            onValueChange={handleServiceToggle}
            accessibilityLabel={t("settings.project.scripts.runAsService")}
            testID="script-edit-service-toggle"
          />
        </View>
      </View>
      {isService ? (
        <View style={styles.modalSection}>
          <Text style={styles.modalLabel}>{t("settings.project.scripts.previewUrl")}</Text>
          <TextInput
            testID="script-edit-preview-url"
            accessibilityLabel={t("settings.project.scripts.previewUrl")}
            initialValue={script.previewUrlText}
            onChangeText={handlePreviewUrlChange}
            placeholder="http://localhost:$PASEO_PORT"
            placeholderTextColor={styles.placeholderColor.color}
            style={styles.modalInput}
          />
          <Text style={styles.modalHint}>{t("settings.project.scripts.previewUrlHint")}</Text>
        </View>
      ) : null}
      <View style={styles.modalFooter}>
        <Button onPress={onCancel} variant="ghost" size="md" testID="script-edit-cancel">
          {t("settings.project.actions.cancel")}
        </Button>
        <Button onPress={handleSavePress} variant="default" size="md" testID="script-edit-save">
          {t("settings.project.actions.save")}
        </Button>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  noTargetContainer: {
    padding: theme.spacing[4],
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  noTargetText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  body: {
    padding: theme.spacing[4],
    gap: theme.spacing[2],
  },
  backButton: {
    alignSelf: "flex-start",
    paddingHorizontal: 0,
  },
  headerBlock: {
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[4],
    gap: theme.spacing[2],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  projectTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    flexShrink: 1,
  },
  editButton: {
    padding: theme.spacing[1],
  },
  titleIconFallbackText: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  iconColor: {
    color: theme.colors.foregroundMuted,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  errorBlock: {
    marginTop: theme.spacing[2],
  },
  emptyScripts: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  scriptRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
  },
  scriptRowWithBorder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  scriptRowMain: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  scriptKebab: {
    padding: theme.spacing[1],
  },
  calloutWrap: {
    marginTop: theme.spacing[3],
  },
  sourceSelectorRow: {
    marginBottom: theme.spacing[4],
    gap: theme.spacing[2],
  },
  sourceSelectorLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  migrateRowContent: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
    paddingRight: theme.spacing[3],
  },
  migrateTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  migrateDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    marginTop: theme.spacing[4],
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  modalSection: {
    gap: theme.spacing[2],
  },
  modalLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  modalInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  modalMultilineInput: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    minHeight: 100,
    textAlignVertical: "top",
  },
  modalFooter: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  fieldError: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.sm,
  },
  serviceToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  serviceToggleText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  serviceToggleLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  modalHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  placeholderColor: {
    color: theme.colors.foregroundMuted,
  },
  chevronColor: {
    color: theme.colors.foregroundMuted,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
}));
