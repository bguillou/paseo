import { existsSync, realpathSync, unlinkSync } from "node:fs";
import { resolve, sep } from "path";
import type pino from "pino";
import type { ProjectConfigSource } from "@getpaseo/protocol/paseo-config-schema";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";
import type { ProjectRegistry } from "../../workspace-registry.js";
import {
  readPaseoConfigForEdit,
  resolvePaseoConfigPath,
  writePaseoConfigForEdit,
  type ProjectConfigRpcError,
  type ReadPaseoConfigForEditResult,
  type WritePaseoConfigForEditResult,
} from "../../../utils/paseo-config-file.js";
import type { GlobalProjectConfigStore } from "../../project-config/global-project-config-store.js";
import { hasUncommittedWorktreeSetupChanges } from "./worktree-setup-commit-status.js";

export interface ProjectConfigSessionHost {
  emit(msg: SessionOutboundMessage): void;
}

export interface ProjectConfigSessionOptions {
  host: ProjectConfigSessionHost;
  projectRegistry: Pick<ProjectRegistry, "list">;
  globalConfigStore: Pick<GlobalProjectConfigStore, "readForEdit" | "stat" | "write">;
  logger: pino.Logger;
}

interface ResolvedProject {
  repoRoot: string;
  projectId: string;
}

/**
 * A client's read/write surface for a project's config, across two layers: the
 * committed paseo.json at the repo root ("project_file") and the per-project
 * user/global config in PASEO_HOME ("global"). The committed file wins at
 * runtime, so "effective" reads report whichever layer is actually in use.
 * Resolves the request's repoRoot against the known (non-archived) project roots
 * — accepting a trailing slash or a symlink via realpath — then reads or writes
 * the requested layer and emits the matching response.
 */
export class ProjectConfigSession {
  private readonly host: ProjectConfigSessionHost;
  private readonly projectRegistry: Pick<ProjectRegistry, "list">;
  private readonly globalConfigStore: Pick<
    GlobalProjectConfigStore,
    "readForEdit" | "stat" | "write"
  >;
  private readonly logger: pino.Logger;

  constructor(options: ProjectConfigSessionOptions) {
    this.host = options.host;
    this.projectRegistry = options.projectRegistry;
    this.globalConfigStore = options.globalConfigStore;
    this.logger = options.logger;
  }

  async handleReadProjectConfigRequest(
    msg: Extract<SessionInboundMessage, { type: "read_project_config_request" }>,
  ): Promise<void> {
    const project = await this.resolveKnownProject(msg.repoRoot);
    if (!project) {
      this.emitProjectConfigReadFailure(msg, { code: "project_not_found" });
      return;
    }

    const requestedSource: ProjectConfigSource = msg.source ?? "project_file";
    const { result, source } = this.readForSource(project, requestedSource);
    if (!result.ok) {
      this.logger.warn(
        {
          repoRoot: project.repoRoot,
          requestId: msg.requestId,
          outcome: result.error.code,
          source,
        },
        "Failed to read project config",
      );
      this.emitProjectConfigReadFailure(msg, result.error, project.repoRoot);
      return;
    }

    // The committed-vs-working-tree setup comparison only makes sense for the
    // committed file; the global layer has no git history to compare against.
    const setupCommitStatus =
      source === "project_file"
        ? await this.readSetupCommitStatus(project.repoRoot, result.config)
        : null;

    this.host.emit({
      type: "read_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot: project.repoRoot,
        ok: true,
        config: result.config,
        revision: result.revision,
        source,
        ...(setupCommitStatus === null
          ? {}
          : { hasUncommittedWorktreeSetupChanges: setupCommitStatus }),
      },
    });
  }

  async handleWriteProjectConfigRequest(
    msg: Extract<SessionInboundMessage, { type: "write_project_config_request" }>,
  ): Promise<void> {
    const project = await this.resolveKnownProject(msg.repoRoot);
    if (!project) {
      this.emitProjectConfigWriteFailure(msg, { code: "project_not_found" });
      return;
    }

    const target = msg.target ?? "project_file";
    this.logger.debug(
      { repoRoot: project.repoRoot, requestId: msg.requestId, outcome: "write_attempt", target },
      "Writing project config",
    );
    const result: WritePaseoConfigForEditResult =
      target === "global"
        ? this.globalConfigStore.write({
            projectId: project.projectId,
            config: msg.config,
            expectedRevision: msg.expectedRevision,
          })
        : writePaseoConfigForEdit({
            repoRoot: project.repoRoot,
            config: msg.config,
            expectedRevision: msg.expectedRevision,
          });
    if (!result.ok) {
      this.logger.debug(
        {
          repoRoot: project.repoRoot,
          requestId: msg.requestId,
          outcome: result.error.code,
          target,
        },
        "Project config write did not complete",
      );
      this.emitProjectConfigWriteFailure(msg, result.error, project.repoRoot);
      return;
    }

    this.logger.debug(
      { repoRoot: project.repoRoot, requestId: msg.requestId, outcome: "written", target },
      "Project config written",
    );
    const setupCommitStatus =
      target === "project_file"
        ? await this.readSetupCommitStatus(project.repoRoot, result.config)
        : null;
    this.host.emit({
      type: "write_project_config_response",
      payload: {
        requestId: msg.requestId,
        repoRoot: project.repoRoot,
        ok: true,
        config: result.config,
        revision: result.revision,
        source: target,
        ...(setupCommitStatus === null
          ? {}
          : { hasUncommittedWorktreeSetupChanges: setupCommitStatus }),
      },
    });
  }

  async handleMigrateProjectConfigToGlobalRequest(
    msg: Extract<SessionInboundMessage, { type: "project.config.migrateToGlobal.request" }>,
  ): Promise<void> {
    const project = await this.resolveKnownProject(msg.repoRoot);
    if (!project) {
      this.emitMigrateFailure(msg, { code: "project_not_found" });
      return;
    }

    const fileResult = readPaseoConfigForEdit(project.repoRoot);
    if (!fileResult.ok) {
      this.emitMigrateFailure(msg, fileResult.error, project.repoRoot);
      return;
    }
    if (fileResult.config === null) {
      // Nothing to migrate — the UI only offers migration when a file exists.
      this.emitMigrateFailure(msg, { code: "invalid_project_config" }, project.repoRoot);
      return;
    }

    const writeResult = this.globalConfigStore.write({
      projectId: project.projectId,
      config: fileResult.config,
      expectedRevision: this.globalConfigStore.stat(project.projectId),
    });
    if (!writeResult.ok) {
      this.emitMigrateFailure(msg, writeResult.error, project.repoRoot);
      return;
    }

    this.host.emit({
      type: "project.config.migrateToGlobal.response",
      payload: {
        requestId: msg.requestId,
        repoRoot: project.repoRoot,
        ok: true,
        projectId: project.projectId,
        config: writeResult.config,
        revision: writeResult.revision,
      },
    });
  }

  async handleDeleteProjectConfigFileRequest(
    msg: Extract<SessionInboundMessage, { type: "project.config.deleteProjectFile.request" }>,
  ): Promise<void> {
    const project = await this.resolveKnownProject(msg.repoRoot);
    if (!project) {
      this.emitDeleteFailure(msg, { code: "project_not_found" });
      return;
    }

    try {
      const configPath = resolvePaseoConfigPath(project.repoRoot);
      if (existsSync(configPath)) {
        unlinkSync(configPath);
      }
    } catch (error) {
      this.logger.warn(
        { repoRoot: project.repoRoot, requestId: msg.requestId, err: error },
        "Failed to delete committed paseo.json",
      );
      this.emitDeleteFailure(msg, { code: "write_failed" }, project.repoRoot);
      return;
    }

    this.host.emit({
      type: "project.config.deleteProjectFile.response",
      payload: { requestId: msg.requestId, repoRoot: project.repoRoot, ok: true },
    });
  }

  private readForSource(
    project: ResolvedProject,
    requestedSource: ProjectConfigSource,
  ): { result: ReadPaseoConfigForEditResult; source: ProjectConfigSource } {
    if (requestedSource === "global") {
      return { result: this.globalConfigStore.readForEdit(project.projectId), source: "global" };
    }
    if (requestedSource === "project_file") {
      return { result: readPaseoConfigForEdit(project.repoRoot), source: "project_file" };
    }
    // "effective": the committed file wins; fall back to the global layer.
    const fileResult = readPaseoConfigForEdit(project.repoRoot);
    if (!fileResult.ok) {
      return { result: fileResult, source: "project_file" };
    }
    if (fileResult.config !== null) {
      return { result: fileResult, source: "project_file" };
    }
    return { result: this.globalConfigStore.readForEdit(project.projectId), source: "global" };
  }

  private async readSetupCommitStatus(
    repoRoot: string,
    config: Parameters<typeof hasUncommittedWorktreeSetupChanges>[0]["currentConfig"],
  ): Promise<boolean | null> {
    try {
      return await hasUncommittedWorktreeSetupChanges({ repoRoot, currentConfig: config });
    } catch (error) {
      this.logger.debug({ repoRoot, error }, "Could not inspect committed worktree setup");
      return null;
    }
  }

  private emitProjectConfigReadFailure(
    msg: Extract<SessionInboundMessage, { type: "read_project_config_request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.host.emit({
      type: "read_project_config_response",
      payload: { requestId: msg.requestId, repoRoot, ok: false, error },
    });
  }

  private emitProjectConfigWriteFailure(
    msg: Extract<SessionInboundMessage, { type: "write_project_config_request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.host.emit({
      type: "write_project_config_response",
      payload: { requestId: msg.requestId, repoRoot, ok: false, error },
    });
  }

  private emitMigrateFailure(
    msg: Extract<SessionInboundMessage, { type: "project.config.migrateToGlobal.request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.host.emit({
      type: "project.config.migrateToGlobal.response",
      payload: { requestId: msg.requestId, repoRoot, ok: false, error },
    });
  }

  private emitDeleteFailure(
    msg: Extract<SessionInboundMessage, { type: "project.config.deleteProjectFile.request" }>,
    error: ProjectConfigRpcError,
    repoRoot = msg.repoRoot,
  ): void {
    this.host.emit({
      type: "project.config.deleteProjectFile.response",
      payload: { requestId: msg.requestId, repoRoot, ok: false, error },
    });
  }

  private async resolveKnownProject(repoRoot: string): Promise<ResolvedProject | null> {
    const requestedRoot = canonicalizeConfigRoot(repoRoot);
    const projects = await this.projectRegistry.list();
    for (const project of projects) {
      if (project.archivedAt !== null) {
        continue;
      }
      const projectRoot = canonicalizeConfigRoot(project.rootPath);
      if (requestedRoot === projectRoot) {
        return { repoRoot: projectRoot, projectId: project.projectId };
      }
    }
    return null;
  }
}

function canonicalizeConfigRoot(repoRoot: string): string {
  const resolved = resolve(repoRoot);
  try {
    return stripTrailingPathSeparators(realpathSync(resolved));
  } catch {
    return stripTrailingPathSeparators(resolved);
  }
}

function stripTrailingPathSeparators(path: string): string {
  let normalized = path;
  while (normalized.length > 1 && normalized.endsWith(sep)) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
