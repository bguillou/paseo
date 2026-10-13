import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useReplicaQuery } from "@/data/query";
import { workspaceTerminalsPushRoute } from "@/data/push-router";
import { ChevronDown, ChevronUp, Play, Plus, Square, X } from "lucide-react-native";
import { ResizeHandle } from "@/components/resize-handle";
import { RetainedPanel } from "@/components/retained-panel";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { TerminalPane } from "@/components/terminal-pane";
import { SetupView } from "@/panels/setup-panel";
import {
  useHostRuntimeClient,
  useHostRuntimeIsConnected,
  useHostRuntimeSnapshot,
} from "@/runtime/host-runtime";
import { useWorkspace, useWorkspaceDirectory } from "@/stores/session-store-hooks";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { usePanelStore } from "@/stores/panel-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import {
  BOTTOM_DOCK_MIN_HEIGHT,
  useBottomDockCollapsed,
  useBottomDockHeight,
  useWorkspaceBottomDockStore,
} from "@/stores/bottom-dock-store";
import {
  buildTerminalsQueryKey,
  collectScriptTerminalIds,
  collectStandaloneTerminalIds,
  removeTerminalFromPayload,
  upsertCreatedTerminalPayload,
  type ListTerminalsPayload,
} from "@/screens/workspace/terminals/state";
import { useMountedTabSet } from "@/screens/workspace/use-mounted-tab-set";
import { useToast } from "@/contexts/toast-context";
import { resolveWorkspaceScriptLink } from "@/utils/workspace-script-links";
import { openServiceUrl } from "@/utils/open-service-url";

const EMPTY_SCRIPTS: WorkspaceDescriptor["scripts"] = [];
const BOTTOM_DOCK_RESIZE_GROUP_ID = "workspace-bottom-dock";
const SETUP_TAB_ID = "setup";
const RUN_TAB_ID = "run";

type DockTab = { kind: "setup" } | { kind: "run" } | { kind: "terminal"; terminalId: string };

type ActiveConnectionType =
  ReturnType<typeof useHostRuntimeSnapshot> extends infer R
    ? R extends { activeConnection: infer A }
      ? A
      : null
    : null;

interface WorkspaceBottomDockProps {
  serverId: string;
  workspaceId: string;
  workspaceKey: string;
  isWorkspaceFocused: boolean;
  containerHeight: number;
}

export function WorkspaceBottomDock({
  serverId,
  workspaceId,
  workspaceKey,
  isWorkspaceFocused,
  containerHeight,
}: WorkspaceBottomDockProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const workspaceDirectory = useWorkspaceDirectory(serverId, workspaceId);
  const descriptor = useWorkspace(serverId, workspaceId);
  const scripts = descriptor?.scripts ?? EMPTY_SCRIPTS;
  const queryClient = useQueryClient();
  const toast = useToast();

  const collapsed = useBottomDockCollapsed(workspaceKey);
  const height = useBottomDockHeight();
  const setCollapsed = useWorkspaceBottomDockStore((state) => state.setCollapsed);
  const setHeight = useWorkspaceBottomDockStore((state) => state.setHeight);

  const queryKey = useMemo(
    () => buildTerminalsQueryKey(serverId, workspaceDirectory, workspaceId || null),
    [serverId, workspaceDirectory, workspaceId],
  );
  const terminalsEnabled = Boolean(client && workspaceDirectory && isConnected);
  const terminalsQuery = useReplicaQuery({
    queryKey,
    enabled: terminalsEnabled,
    pushEvent: "terminals_changed",
    meta: workspaceTerminalsPushRoute({
      enabled: terminalsEnabled,
      serverId,
      cwd: workspaceDirectory ?? "",
      ...(workspaceId ? { workspaceId } : {}),
    }),
    queryFn: async (): Promise<ListTerminalsPayload> => {
      if (!client || !workspaceDirectory) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      return client.listTerminals(workspaceDirectory, undefined, {
        workspaceId: workspaceId || undefined,
      });
    },
  });
  const terminals = useMemo(() => terminalsQuery.data?.terminals ?? [], [terminalsQuery.data]);
  const scriptTerminalIds = useMemo(
    () => collectScriptTerminalIds({ pendingScriptTerminalIds: new Map(), scripts }),
    [scripts],
  );
  // Terminals the user opened into a pane live there, not in the dock.
  const workspaceLayout = useWorkspaceLayoutStore(
    (state) => state.layoutByWorkspace[workspaceKey] ?? null,
  );
  const paneTerminalIds = useMemo(() => {
    const ids = new Set<string>();
    if (!workspaceLayout) return ids;
    for (const tab of collectAllTabs(workspaceLayout.root)) {
      if (tab.target.kind === "terminal") {
        ids.add(tab.target.terminalId);
      }
    }
    return ids;
  }, [workspaceLayout]);
  const standaloneTerminalIds = useMemo(
    () =>
      collectStandaloneTerminalIds({
        terminals,
        scriptTerminalIds,
        excludedTerminalIds: paneTerminalIds,
      }),
    [terminals, scriptTerminalIds, paneTerminalIds],
  );

  const [activeTab, setActiveTab] = useState<DockTab>({ kind: "setup" });

  // Keep the active terminal tab valid; fall back when it disappears.
  useEffect(() => {
    if (activeTab.kind !== "terminal") return;
    if (!standaloneTerminalIds.includes(activeTab.terminalId)) {
      setActiveTab(
        standaloneTerminalIds.length > 0
          ? { kind: "terminal", terminalId: standaloneTerminalIds[0]! }
          : { kind: "setup" },
      );
    }
  }, [activeTab, standaloneTerminalIds]);

  // Mount a tab's content only once it has been active. A terminal mounted while
  // hidden (display:none) measures 0x0, so xterm's FitAddon bails and renders a
  // blank surface that does not recover reliably on reveal. Lazy-mounting (like
  // the pane host) guarantees each terminal first renders while visible and sized.
  const allTabIds = useMemo(
    () => [SETUP_TAB_ID, RUN_TAB_ID, ...standaloneTerminalIds],
    [standaloneTerminalIds],
  );
  const activeTabId = activeTab.kind === "terminal" ? activeTab.terminalId : activeTab.kind;
  const { mountedTabIds } = useMountedTabSet({
    activeTabId,
    allTabIds,
    cap: Math.max(1, allTabIds.length),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!client || !workspaceDirectory) {
        throw new Error(t("workspace.terminal.hostDisconnected"));
      }
      const payload = await client.createTerminal(workspaceDirectory, undefined, undefined, {
        workspaceId: workspaceId || undefined,
      });
      if (!payload.terminal && payload.error) {
        throw new Error(payload.error);
      }
      return payload;
    },
    onSuccess: (payload) => {
      const created = payload.terminal;
      if (!created) return;
      queryClient.setQueryData<ListTerminalsPayload>(queryKey, (current) =>
        upsertCreatedTerminalPayload({ current, terminal: created, workspaceDirectory }),
      );
      setActiveTab({ kind: "terminal", terminalId: created.id });
    },
    onError: (error) => {
      toast.show(error instanceof Error ? error.message : t("workspace.terminal.createFailed"), {
        variant: "error",
      });
    },
  });

  const killMutation = useMutation({
    mutationFn: async (terminalId: string) => {
      if (!client) throw new Error(t("workspace.terminal.hostDisconnected"));
      return client.killTerminal(terminalId);
    },
    onSuccess: (_result, terminalId) => {
      queryClient.setQueryData<ListTerminalsPayload>(
        queryKey,
        removeTerminalFromPayload(terminalId),
      );
    },
  });

  // Auto-open one terminal so the Terminal tab is always populated.
  const autoCreatedRef = useRef(false);
  useEffect(() => {
    if (autoCreatedRef.current) return;
    if (!client || !workspaceDirectory || !isConnected) return;
    if (!terminalsQuery.isSuccess) return;
    if (standaloneTerminalIds.length > 0 || createMutation.isPending) return;
    autoCreatedRef.current = true;
    createMutation.mutate();
  }, [
    client,
    workspaceDirectory,
    isConnected,
    terminalsQuery.isSuccess,
    standaloneTerminalIds.length,
    createMutation,
  ]);

  const createDisabled = !client || !workspaceDirectory || !isConnected || createMutation.isPending;

  const handleToggleCollapse = useCallback(() => {
    setCollapsed(workspaceKey, !collapsed);
  }, [collapsed, setCollapsed, workspaceKey]);

  const handleCreateTerminal = useCallback(() => {
    if (createDisabled) return;
    if (collapsed) setCollapsed(workspaceKey, false);
    createMutation.mutate();
  }, [collapsed, createDisabled, createMutation, setCollapsed, workspaceKey]);

  const handleSelectTab = useCallback(
    (kind: DockTab["kind"], terminalId?: string) => {
      if (collapsed) setCollapsed(workspaceKey, false);
      if (kind === "terminal" && terminalId) {
        setActiveTab({ kind: "terminal", terminalId });
      } else if (kind === "run") {
        setActiveTab({ kind: "run" });
      } else {
        setActiveTab({ kind: "setup" });
      }
    },
    [collapsed, setCollapsed, workspaceKey],
  );

  const handleCloseTerminal = useCallback(
    (terminalId: string) => killMutation.mutate(terminalId),
    [killMutation],
  );

  const collapseAccessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);

  // Vertical resize: the dock is the second child of a conceptual [content, dock]
  // column; the handle sits at the top of the dock and sizes[1] is the dock share.
  const resizeSizes = useMemo(() => {
    const safeContainer = containerHeight > 0 ? containerHeight : height;
    const fraction = Math.min(0.9, Math.max(0.1, height / safeContainer));
    return [1 - fraction, fraction];
  }, [containerHeight, height]);
  const applyResize = useCallback(
    (_groupId: string, sizes: number[]) => {
      if (containerHeight <= 0) return;
      const next = sizes[1] ?? 0;
      setHeight(Math.round(next * containerHeight));
    },
    [containerHeight, setHeight],
  );

  const activeConnection = useHostRuntimeSnapshot(serverId)?.activeConnection ?? null;

  const bodyHeight = Math.max(BOTTOM_DOCK_MIN_HEIGHT - HEADER_HEIGHT, height - HEADER_HEIGHT);

  return (
    <View style={styles.dock} testID="workspace-bottom-dock">
      {!collapsed && containerHeight > 0 ? (
        <ResizeHandle
          testID="workspace-bottom-dock-resize-handle"
          direction="vertical"
          hitAreaAlignment="end"
          groupId={BOTTOM_DOCK_RESIZE_GROUP_ID}
          index={0}
          sizes={resizeSizes}
          containerSize={containerHeight}
          onPreviewResizeSplit={applyResize}
          onResizeSplit={applyResize}
        />
      ) : null}

      <View style={styles.header}>
        <HeaderToggleButton
          testID="workspace-bottom-dock-collapse"
          onPress={handleToggleCollapse}
          tooltipLabel={
            collapsed ? t("workspace.bottomDock.expand") : t("workspace.bottomDock.collapse")
          }
          tooltipKeys={[]}
          tooltipSide="top"
          accessibilityState={collapseAccessibilityState}
        >
          {collapsed ? (
            <ChevronUp size={ICON_SIZE} color={styles.icon.color} />
          ) : (
            <ChevronDown size={ICON_SIZE} color={styles.icon.color} />
          )}
        </HeaderToggleButton>

        <View style={styles.tabsRow}>
          <DockTabChip
            kind="setup"
            label={t("workspace.bottomDock.tabs.setup")}
            active={activeTab.kind === "setup"}
            testID="workspace-bottom-dock-tab-setup"
            onSelect={handleSelectTab}
          />
          <DockTabChip
            kind="run"
            label={t("workspace.bottomDock.tabs.run")}
            active={activeTab.kind === "run"}
            testID="workspace-bottom-dock-tab-run"
            onSelect={handleSelectTab}
          />
          {standaloneTerminalIds.map((terminalId, index) => (
            <DockTabChip
              key={terminalId}
              kind="terminal"
              terminalId={terminalId}
              label={
                index === 0
                  ? t("workspace.bottomDock.tabs.terminal")
                  : t("workspace.bottomDock.tabs.terminalNumbered", { index: index + 1 })
              }
              active={activeTab.kind === "terminal" && activeTab.terminalId === terminalId}
              testID={`workspace-bottom-dock-tab-terminal-${terminalId}`}
              onSelect={handleSelectTab}
              onClose={handleCloseTerminal}
            />
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("workspace.bottomDock.newTerminal")}
            testID="workspace-bottom-dock-new-terminal"
            onPress={handleCreateTerminal}
            disabled={createDisabled}
            style={styles.addButton}
          >
            <Plus size={ICON_SIZE} color={styles.icon.color} />
          </Pressable>
        </View>
      </View>

      {!collapsed ? (
        <View style={[styles.body, { height: bodyHeight, minHeight: bodyHeight }]}>
          {mountedTabIds.has(SETUP_TAB_ID) ? (
            <RetainedPanel active={activeTab.kind === "setup"}>
              <SetupView serverId={serverId} workspaceId={workspaceId} />
            </RetainedPanel>
          ) : null}
          {mountedTabIds.has(RUN_TAB_ID) ? (
            <RetainedPanel active={activeTab.kind === "run"}>
              <RunView
                serverId={serverId}
                workspaceId={workspaceId}
                workspaceDirectory={workspaceDirectory}
                scripts={scripts}
                activeConnection={activeConnection}
                isWorkspaceFocused={isWorkspaceFocused}
                isActive={activeTab.kind === "run"}
              />
            </RetainedPanel>
          ) : null}
          {standaloneTerminalIds.map((terminalId) => {
            if (!mountedTabIds.has(terminalId)) return null;
            const isActive = activeTab.kind === "terminal" && activeTab.terminalId === terminalId;
            return (
              <RetainedPanel key={terminalId} active={isActive}>
                <DockTerminal
                  serverId={serverId}
                  workspaceDirectory={workspaceDirectory}
                  terminalId={terminalId}
                  isWorkspaceFocused={isWorkspaceFocused}
                  isPaneFocused={isActive && isWorkspaceFocused}
                />
              </RetainedPanel>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function DockTerminal({
  serverId,
  workspaceDirectory,
  terminalId,
  isWorkspaceFocused,
  isPaneFocused,
}: {
  serverId: string;
  workspaceDirectory: string | null;
  terminalId: string;
  isWorkspaceFocused: boolean;
  isPaneFocused: boolean;
}) {
  const openCompactFileExplorer = usePanelStore((state) => state.openCompactFileExplorer);
  const handleOpenFileExplorer = useCallback(() => {
    if (!workspaceDirectory) return;
    openCompactFileExplorer({ serverId, cwd: workspaceDirectory, isGit: true });
  }, [openCompactFileExplorer, serverId, workspaceDirectory]);
  if (!workspaceDirectory) {
    return null;
  }
  return (
    <TerminalPane
      serverId={serverId}
      cwd={workspaceDirectory}
      terminalId={terminalId}
      isWorkspaceFocused={isWorkspaceFocused}
      isPaneFocused={isPaneFocused}
      onOpenFileExplorer={handleOpenFileExplorer}
      onOpenWorkspaceFile={noop}
    />
  );
}

function RunView({
  serverId,
  workspaceId,
  workspaceDirectory,
  scripts,
  activeConnection,
  isWorkspaceFocused,
  isActive,
}: {
  serverId: string;
  workspaceId: string;
  workspaceDirectory: string | null;
  scripts: WorkspaceDescriptor["scripts"];
  activeConnection: ActiveConnectionType;
  isWorkspaceFocused: boolean;
  isActive: boolean;
}) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const toast = useToast();
  const [selectedScriptName, setSelectedScriptName] = useState<string | null>(null);
  const startMutation = useMutation({
    mutationFn: async (scriptName: string) => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      const result = await client.startWorkspaceScript(workspaceId, scriptName);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onError: (error) => {
      toast.show(error instanceof Error ? error.message : t("workspace.scripts.title"), {
        variant: "error",
      });
    },
    onSuccess: (_result, scriptName) => {
      // Reveal the started script's output in this tab.
      setSelectedScriptName(scriptName);
    },
  });
  const stopMutation = useMutation({
    mutationFn: async (terminalId: string) => {
      if (!client) throw new Error(t("common.errors.daemonClientUnavailable"));
      return client.killTerminal(terminalId);
    },
  });

  const handleSelect = useCallback((scriptName: string) => setSelectedScriptName(scriptName), []);
  const runningWithTerminal = useMemo(
    () => scripts.find((script) => script.lifecycle === "running" && script.terminalId) ?? null,
    [scripts],
  );
  const effectiveSelected = selectedScriptName ?? runningWithTerminal?.scriptName ?? null;
  const selectedScript = useMemo(
    () => scripts.find((script) => script.scriptName === effectiveSelected) ?? null,
    [scripts, effectiveSelected],
  );
  const outputTerminalId =
    selectedScript && selectedScript.lifecycle === "running"
      ? (selectedScript.terminalId ?? null)
      : null;

  if (scripts.length === 0) {
    return (
      <View style={styles.runEmpty}>
        <Text style={styles.runEmptyText}>{t("workspace.bottomDock.run.empty")}</Text>
      </View>
    );
  }

  return (
    <View style={styles.runContainer} testID="workspace-bottom-dock-run">
      <View style={styles.runList}>
        {scripts.map((script) => (
          <RunRow
            key={script.scriptName}
            script={script}
            activeConnection={activeConnection}
            selected={script.scriptName === effectiveSelected}
            onSelect={handleSelect}
            onStart={startMutation.mutate}
            onStop={stopMutation.mutate}
          />
        ))}
      </View>
      <View style={styles.runOutput}>
        {outputTerminalId && workspaceDirectory ? (
          <DockTerminal
            serverId={serverId}
            workspaceDirectory={workspaceDirectory}
            terminalId={outputTerminalId}
            isWorkspaceFocused={isWorkspaceFocused}
            isPaneFocused={isActive && isWorkspaceFocused}
          />
        ) : (
          <View style={styles.runEmpty}>
            <Text style={styles.runEmptyText}>{t("workspace.bottomDock.run.noOutput")}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

function RunRow({
  script,
  activeConnection,
  selected,
  onSelect,
  onStart,
  onStop,
}: {
  script: WorkspaceDescriptor["scripts"][number];
  activeConnection: ActiveConnectionType;
  selected: boolean;
  onSelect: (scriptName: string) => void;
  onStart: (scriptName: string) => void;
  onStop: (terminalId: string) => void;
}) {
  const { t } = useTranslation();
  const isRunning = script.lifecycle === "running";
  const link = resolveWorkspaceScriptLink({ script, activeConnection });
  const url = link.primary?.url ?? null;
  const handleSelect = useCallback(
    () => onSelect(script.scriptName),
    [onSelect, script.scriptName],
  );
  const handleOpen = useCallback(() => {
    if (url) void openServiceUrl(url, {});
  }, [url]);
  const handleToggle = useCallback(() => {
    if (isRunning) {
      if (script.terminalId) onStop(script.terminalId);
    } else {
      onStart(script.scriptName);
    }
  }, [isRunning, onStart, onStop, script.scriptName, script.terminalId]);
  return (
    <View style={[styles.runRow, selected ? styles.runRowSelected : undefined]}>
      <Pressable
        accessibilityRole="button"
        onPress={handleSelect}
        style={styles.runRowMain}
        testID={`workspace-bottom-dock-run-select-${script.scriptName}`}
      >
        <View style={[styles.runStatusDot, isRunning ? styles.runStatusDotOn : undefined]} />
        <Text style={styles.runName} numberOfLines={1}>
          {script.scriptName}
        </Text>
      </Pressable>
      {isRunning && url ? (
        <Pressable
          accessibilityRole="button"
          onPress={handleOpen}
          style={styles.runAction}
          testID={`workspace-bottom-dock-run-open-${script.scriptName}`}
        >
          <Text style={styles.runOpenLabel}>{t("workspace.scripts.actions.openService")}</Text>
        </Pressable>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          isRunning
            ? t("workspace.scripts.accessibility.stopScript", { scriptName: script.scriptName })
            : t("workspace.scripts.accessibility.runScript", { scriptName: script.scriptName })
        }
        testID={`workspace-bottom-dock-run-toggle-${script.scriptName}`}
        onPress={handleToggle}
        style={styles.runAction}
      >
        {isRunning ? (
          <Square size={ICON_SIZE} color={styles.icon.color} />
        ) : (
          <Play size={ICON_SIZE} color={styles.icon.color} />
        )}
      </Pressable>
    </View>
  );
}

function DockTabChip({
  kind,
  terminalId,
  label,
  active,
  onSelect,
  onClose,
  testID,
}: {
  kind: DockTab["kind"];
  terminalId?: string;
  label: string;
  active: boolean;
  onSelect: (kind: DockTab["kind"], terminalId?: string) => void;
  onClose?: (terminalId: string) => void;
  testID?: string;
}) {
  const handlePress = useCallback(() => onSelect(kind, terminalId), [onSelect, kind, terminalId]);
  const handleClose = useCallback(() => {
    if (terminalId) onClose?.(terminalId);
  }, [onClose, terminalId]);
  return (
    <View style={[styles.tabChip, active ? styles.tabChipActive : undefined]}>
      <Pressable
        accessibilityRole="tab"
        onPress={handlePress}
        testID={testID}
        style={styles.tabPress}
      >
        <Text style={[styles.tabLabel, active ? styles.tabLabelActive : undefined]}>{label}</Text>
      </Pressable>
      {onClose && terminalId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={handleClose}
          testID={testID ? `${testID}-close` : undefined}
          style={styles.tabClose}
        >
          <X size={ICON_SIZE - 2} color={styles.iconMuted.color} />
        </Pressable>
      ) : null}
    </View>
  );
}

function noop() {}

const ICON_SIZE = 14;
const HEADER_HEIGHT = 40;

const styles = StyleSheet.create((theme) => ({
  dock: {
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  tabsRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  tabChip: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
    paddingHorizontal: theme.spacing[2],
    height: HEADER_HEIGHT,
  },
  tabChipActive: {
    borderBottomColor: theme.colors.primary,
  },
  tabPress: {
    justifyContent: "center",
    height: "100%",
  },
  tabLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.medium,
  },
  tabLabelActive: {
    color: theme.colors.foreground,
  },
  tabClose: {
    marginLeft: theme.spacing[1],
    padding: theme.spacing[1],
  },
  addButton: {
    padding: theme.spacing[1],
  },
  body: {
    // Fixed-height panel: do NOT use `flex: 0` here. In React Native the `flex`
    // shorthand sets flexBasis:0, which overrides the explicit `height` on the
    // main axis and collapses the body (and its flex:1 children) to 0.
    flexGrow: 0,
    flexShrink: 0,
    overflow: "hidden",
  },
  icon: {
    color: theme.colors.foreground,
  },
  iconMuted: {
    color: theme.colors.foregroundMuted,
  },
  runContainer: {
    flex: 1,
    minHeight: 0,
  },
  runList: {
    paddingVertical: theme.spacing[1],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  runOutput: {
    flex: 1,
    minHeight: 0,
  },
  runRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  runRowSelected: {
    backgroundColor: theme.colors.muted,
  },
  runRowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  runStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.foregroundMuted,
  },
  runStatusDotOn: {
    backgroundColor: theme.colors.primary,
  },
  runName: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  runAction: {
    padding: theme.spacing[1],
  },
  runOpenLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.primary,
  },
  runEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[6],
  },
  runEmptyText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
  },
}));
