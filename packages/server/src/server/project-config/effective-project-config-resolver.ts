import { PaseoConfigSchema, type PaseoConfig } from "@getpaseo/protocol/paseo-config-schema";
import { statPaseoConfigPath } from "../../utils/paseo-config-file.js";
import { paseoConfigParseError, readPaseoConfig } from "../../utils/worktree.js";
import { areEquivalentPaths } from "../../utils/path.js";
import type { ProjectRegistry, WorkspaceRegistry } from "../workspace-registry.js";
import type { GlobalProjectConfigStore } from "./global-project-config-store.js";

export type EffectiveProjectConfigSource = "project_file" | "global" | "none";

export interface EffectiveProjectConfig {
  source: EffectiveProjectConfigSource;
  config: PaseoConfig | null;
  projectId: string | null;
}

export interface ResolvedProjectRoot {
  projectId: string;
  rootPath: string;
}

export interface EffectiveProjectConfigResolverOptions {
  projectRegistry: Pick<ProjectRegistry, "list">;
  workspaceRegistry: Pick<WorkspaceRegistry, "list">;
  store: Pick<GlobalProjectConfigStore, "exists" | "readRawJson">;
}

/**
 * Single source of truth for which paseo.json a project actually uses at
 * runtime. The committed file at the working path wins; the per-project global
 * config in PASEO_HOME is the fallback consulted only when no file is present.
 * Mapping an arbitrary worktree cwd back to its owning projectId goes through
 * the workspace registry (then the project registry), so every worktree of a
 * project shares one global config.
 */
export class EffectiveProjectConfigResolver {
  private readonly projectRegistry: Pick<ProjectRegistry, "list">;
  private readonly workspaceRegistry: Pick<WorkspaceRegistry, "list">;
  private readonly store: Pick<GlobalProjectConfigStore, "exists" | "readRawJson">;

  constructor(options: EffectiveProjectConfigResolverOptions) {
    this.projectRegistry = options.projectRegistry;
    this.workspaceRegistry = options.workspaceRegistry;
    this.store = options.store;
  }

  /** Effective config for a working directory (worktree cwd or repo root). */
  async resolveByCwd(cwd: string): Promise<EffectiveProjectConfig> {
    const fileConfig = this.readProjectFile(cwd);
    if (fileConfig !== null) {
      return {
        source: "project_file",
        config: fileConfig,
        projectId: await this.findProjectId(cwd),
      };
    }
    const projectId = await this.findProjectId(cwd);
    return this.resolveGlobalOrNone(projectId);
  }

  /**
   * Effective config for a known workspace. Uses the workspace cwd for the
   * file check and its projectId for the global lookup — no registry scan.
   */
  async resolveByWorkspace(workspace: {
    cwd: string;
    projectId: string;
  }): Promise<EffectiveProjectConfig> {
    const fileConfig = this.readProjectFile(workspace.cwd);
    if (fileConfig !== null) {
      return { source: "project_file", config: fileConfig, projectId: workspace.projectId };
    }
    return this.resolveGlobalOrNone(workspace.projectId);
  }

  /** The config the runtime uses, for a working directory. */
  async effectiveConfigByCwd(cwd: string): Promise<PaseoConfig | null> {
    return (await this.resolveByCwd(cwd)).config;
  }

  /** The config the runtime uses, for a known workspace. */
  async effectiveConfigByWorkspace(workspace: {
    cwd: string;
    projectId: string;
  }): Promise<PaseoConfig | null> {
    return (await this.resolveByWorkspace(workspace)).config;
  }

  /** Map an editor repoRoot to its registered project (non-archived) root + id. */
  async resolveProjectIdByRoot(repoRoot: string): Promise<ResolvedProjectRoot | null> {
    const projects = await this.projectRegistry.list();
    for (const project of projects) {
      if (project.archivedAt !== null) {
        continue;
      }
      if (areEquivalentPaths(repoRoot, project.rootPath)) {
        return { projectId: project.projectId, rootPath: project.rootPath };
      }
    }
    return null;
  }

  /** Read and leniently parse a committed paseo.json at a path; null when absent. */
  private readProjectFile(cwd: string): PaseoConfig | null {
    if (statPaseoConfigPath(cwd) === null) {
      return null;
    }
    const result = readPaseoConfig(cwd);
    if (!result.ok) {
      throw paseoConfigParseError(result);
    }
    return result.config;
  }

  private resolveGlobalOrNone(projectId: string | null): EffectiveProjectConfig {
    if (projectId !== null && this.store.exists(projectId)) {
      const json = this.store.readRawJson(projectId);
      if (json !== null) {
        return { source: "global", config: PaseoConfigSchema.parse(json), projectId };
      }
    }
    return { source: "none", config: null, projectId };
  }

  private async findProjectId(cwd: string): Promise<string | null> {
    const workspaces = await this.workspaceRegistry.list();
    for (const workspace of workspaces) {
      if (workspace.archivedAt !== null) {
        continue;
      }
      if (
        areEquivalentPaths(cwd, workspace.cwd) ||
        (workspace.worktreeRoot !== null && areEquivalentPaths(cwd, workspace.worktreeRoot)) ||
        (workspace.mainRepoRoot !== null && areEquivalentPaths(cwd, workspace.mainRepoRoot))
      ) {
        return workspace.projectId;
      }
    }

    const projects = await this.projectRegistry.list();
    for (const project of projects) {
      if (project.archivedAt !== null) {
        continue;
      }
      if (areEquivalentPaths(cwd, project.rootPath)) {
        return project.projectId;
      }
    }

    return null;
  }
}
