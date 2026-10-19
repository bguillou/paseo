import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  WorkspaceStatusDefinitionSchema,
  type WorkspaceManualStatus,
  type WorkspaceStatusDefinition,
} from "@getpaseo/protocol/messages";
import { normalizeWorkspaceLabelName } from "@getpaseo/protocol/workspace-labels";
import { WORKSPACE_AUTO_STATUSES } from "@getpaseo/protocol/workspace-statuses";
import { writeJsonFileAtomic } from "./atomic-file.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";

type WorkspaceStatusColor = WorkspaceStatusDefinition["color"];
type CatalogListener = (statuses: WorkspaceStatusDefinition[]) => void;

export class WorkspaceStatusError extends Error {
  constructor(
    public readonly code:
      | "status_name_empty"
      | "status_name_taken"
      | "status_not_found"
      | "workspace_not_found",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceStatusError";
  }
}

/**
 * Host-local catalog of custom workspace statuses plus manual status assignment.
 *
 * Workspaces reference custom statuses by id, so renaming or recolouring touches the catalog
 * file only. Deleting a status writes the catalog first and then clears assignments; a crash in
 * between leaves dangling ids, which clients resolve to the derived status.
 */
export class WorkspaceStatusService {
  private statuses: WorkspaceStatusDefinition[] = [];
  private loading?: Promise<void>;
  private operations: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<CatalogListener>();
  private readonly createId: () => string;
  private readonly writeCatalog: (
    filePath: string,
    statuses: readonly WorkspaceStatusDefinition[],
  ) => Promise<void>;

  constructor(
    private readonly options: {
      filePath: string;
      workspaceRegistry: WorkspaceRegistry;
      createId?: () => string;
      writeCatalog?: (
        filePath: string,
        statuses: readonly WorkspaceStatusDefinition[],
      ) => Promise<void>;
    },
  ) {
    this.createId = options.createId ?? (() => `sts_${randomUUID()}`);
    this.writeCatalog = options.writeCatalog ?? writeJsonFileAtomic;
  }

  async initialize(): Promise<void> {
    this.loading ??= this.load();
    await this.loading;
  }

  private async load(): Promise<void> {
    this.statuses = await this.readCatalog();
  }

  async list(): Promise<WorkspaceStatusDefinition[]> {
    await this.initialize();
    return this.snapshot();
  }

  /** Returns the current catalog and registers `listener` for every later change, atomically. */
  async observe(
    listener: CatalogListener,
  ): Promise<{ statuses: WorkspaceStatusDefinition[]; unsubscribe: () => void }> {
    await this.initialize();
    this.listeners.add(listener);
    return { statuses: this.snapshot(), unsubscribe: () => this.listeners.delete(listener) };
  }

  async create(input: {
    name: string;
    color: WorkspaceStatusColor;
  }): Promise<WorkspaceStatusDefinition> {
    return this.exclusive(async () => {
      const name = this.requireAvailableName(input.name);
      const status = { id: this.createId(), name, color: input.color };
      await this.commitCatalog([...this.statuses, status]);
      return { ...status };
    });
  }

  async update(input: {
    id: string;
    name?: string;
    color?: WorkspaceStatusColor;
  }): Promise<WorkspaceStatusDefinition> {
    return this.exclusive(async () => {
      const existing = this.requireStatus(input.id);
      const status = {
        id: existing.id,
        name:
          input.name === undefined
            ? existing.name
            : this.requireAvailableName(input.name, input.id),
        color: input.color ?? existing.color,
      };
      if (status.name === existing.name && status.color === existing.color) return { ...existing };
      await this.commitCatalog(
        this.statuses.map((candidate) => (candidate.id === input.id ? status : candidate)),
      );
      return { ...status };
    });
  }

  async delete(id: string): Promise<{ affectedWorkspaceCount: number }> {
    return this.exclusive(async () => {
      if (!this.statuses.some((status) => status.id === id)) return { affectedWorkspaceCount: 0 };
      await this.commitCatalog(this.statuses.filter((status) => status.id !== id));
      const assigned = (await this.options.workspaceRegistry.list()).filter(
        (workspace) => workspace.manualStatus?.statusId === id,
      );
      const updatedAt = new Date().toISOString();
      await Promise.all(
        assigned.map((workspace) =>
          this.options.workspaceRegistry.update(workspace.workspaceId, (existing) =>
            existing.manualStatus?.statusId === id
              ? { ...existing, manualStatus: undefined, updatedAt }
              : existing,
          ),
        ),
      );
      return { affectedWorkspaceCount: assigned.length };
    });
  }

  async setAssignment(input: {
    workspaceId: string;
    manualStatus: WorkspaceManualStatus | null;
  }): Promise<WorkspaceManualStatus | null> {
    return this.exclusive(async () => {
      const { manualStatus } = input;
      if (manualStatus) this.requireAssignableStatus(manualStatus.statusId);
      const workspace = await this.options.workspaceRegistry.get(input.workspaceId);
      if (!workspace || workspace.archivedAt) {
        throw new WorkspaceStatusError("workspace_not_found", "Workspace not found");
      }
      const updated = await this.options.workspaceRegistry.update(
        input.workspaceId,
        (existing) => ({
          ...existing,
          manualStatus: manualStatus ?? undefined,
          updatedAt: new Date().toISOString(),
        }),
      );
      return updated?.manualStatus ?? null;
    });
  }

  private snapshot(): WorkspaceStatusDefinition[] {
    return this.statuses.map((status) => ({ ...status }));
  }

  private async commitCatalog(next: WorkspaceStatusDefinition[]): Promise<void> {
    await this.writeCatalog(this.options.filePath, next);
    this.statuses = next;
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot());
      } catch {
        // Publication follows durable persistence and cannot fail the mutation.
      }
    }
  }

  private requireStatus(id: string): WorkspaceStatusDefinition {
    const status = this.statuses.find((candidate) => candidate.id === id);
    if (!status) throw new WorkspaceStatusError("status_not_found", "Status not found");
    return status;
  }

  private requireAssignableStatus(statusId: string): void {
    if (WORKSPACE_AUTO_STATUSES.some((autoStatus) => autoStatus === statusId)) return;
    this.requireStatus(statusId);
  }

  private requireAvailableName(raw: string, ownId?: string): string {
    const name = normalizeWorkspaceLabelName(raw);
    if (name.length === 0) {
      throw new WorkspaceStatusError("status_name_empty", "Status name cannot be empty");
    }
    const key = name.toLowerCase();
    const taken = this.statuses.some(
      (status) => status.id !== ownId && status.name.toLowerCase() === key,
    );
    if (taken) {
      throw new WorkspaceStatusError("status_name_taken", "A status with that name already exists");
    }
    return name;
  }

  private async readCatalog(): Promise<WorkspaceStatusDefinition[]> {
    try {
      const raw = await fs.readFile(this.options.filePath, "utf8");
      return z.array(WorkspaceStatusDefinitionSchema).parse(JSON.parse(raw));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operations;
    let release!: () => void;
    this.operations = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await this.initialize();
      return await operation();
    } finally {
      release();
    }
  }
}
