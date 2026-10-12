import type { ProjectSummary, WorkspaceSummary } from "@/utils/projects";
import { shortenPath } from "@/utils/shorten-path";

export const PROJECT_OPTION_PREFIX = "project:";

/** An existing worktree workspace a schedule can reuse instead of creating a new one. */
export interface ScheduleWorktreeOption {
  workspaceId: string;
  label: string;
}

export interface ScheduleProjectTarget {
  optionId: string;
  serverId: string;
  serverName: string;
  projectViewKey: string;
  projectName: string;
  cwd: string;
  isGit: boolean;
  /** Existing worktrees on this host/project, selectable for "existing worktree" isolation. */
  worktrees: ScheduleWorktreeOption[];
}

export function buildProjectOptionId(serverId: string, projectViewKey: string): string {
  return `${PROJECT_OPTION_PREFIX}${serverId}:${projectViewKey}`;
}

/**
 * The project roots the schedule form can target: one per online host of each
 * project, keyed by (serverId, cwd). The schedules list reuses this set to name
 * a schedule's stored cwd; the two surfaces must agree on what "a project" is.
 */
export function buildScheduleProjectTargets(
  projects: readonly ProjectSummary[],
): ScheduleProjectTarget[] {
  const targets: ScheduleProjectTarget[] = [];
  for (const project of projects) {
    for (const host of project.hosts) {
      const cwd = host.repoRoot.trim();
      if (!host.isOnline || !cwd) {
        continue;
      }
      targets.push({
        optionId: buildProjectOptionId(host.serverId, project.viewKey),
        serverId: host.serverId,
        serverName: host.serverName,
        projectViewKey: project.viewKey,
        projectName: host.projectName,
        cwd,
        isGit: Boolean(host.gitRuntime),
        worktrees: buildWorktreeOptions(host.workspaces),
      });
    }
  }
  return targets;
}

/** Active worktree workspaces on a host, as selectable schedule targets. */
function buildWorktreeOptions(workspaces: readonly WorkspaceSummary[]): ScheduleWorktreeOption[] {
  const options: ScheduleWorktreeOption[] = [];
  for (const workspace of workspaces) {
    if (workspace.workspaceKind !== "worktree" || workspace.archivingAt) {
      continue;
    }
    const label = workspace.name.trim() || workspace.currentBranch?.trim() || workspace.id;
    options.push({ workspaceId: workspace.id, label });
  }
  return options;
}

function projectNameKey(serverId: string, cwd: string): string {
  return `${serverId}:${cwd.trim()}`;
}

/** Map (serverId, cwd) -> project name for naming a schedule's stored cwd. */
export function buildProjectNameByCwd(
  targets: readonly ScheduleProjectTarget[],
): Map<string, string> {
  const byCwd = new Map<string, string>();
  for (const target of targets) {
    byCwd.set(projectNameKey(target.serverId, target.cwd), target.projectName);
  }
  return byCwd;
}

/**
 * Name a stored cwd for display: the matching project name when the client
 * knows this root on this host, otherwise the shortened path itself. Never
 * blank, never a claim the client cannot back up.
 */
export function describeScheduleCwd(input: {
  serverId: string;
  cwd: string;
  projectNameByCwd: ReadonlyMap<string, string>;
}): string {
  return (
    input.projectNameByCwd.get(projectNameKey(input.serverId, input.cwd)) ?? shortenPath(input.cwd)
  );
}
