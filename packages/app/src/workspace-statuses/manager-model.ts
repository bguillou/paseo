import type { TFunction } from "i18next";
import type { WorkspaceStatusDefinition } from "@getpaseo/protocol/messages";
import {
  normalizeWorkspaceLabelName,
  WORKSPACE_LABEL_COLORS,
} from "@getpaseo/protocol/workspace-labels";
import {
  buildAllPrStatusGroups,
  customPrStatusGroupId,
  getPrStatusBucketLabel,
  PR_STATUS_BUCKET_ORDER,
  type PrStatusGroupLeading,
} from "@/hooks/sidebar-pr-status-view-model";
import { i18n } from "@/i18n/i18next";
import { orderBoardColumns } from "@/kanban/model";
import type { WorkspaceStatusCatalogs } from "@/workspace-statuses";

type StatusColor = WorkspaceStatusDefinition["color"];

export interface WorkspaceStatusManagerHost {
  serverId: string;
  label: string;
  status: "offline" | "online" | "unsupported";
  statuses: readonly WorkspaceStatusDefinition[];
  error: string | null;
}

export type WorkspaceStatusManagerDraft =
  | { mode: "create"; name: string; color: StatusColor }
  | { mode: "edit"; original: WorkspaceStatusDefinition; name: string; color: StatusColor };

export interface WorkspaceStatusManagerSnapshot {
  serverId: string | null;
  host: WorkspaceStatusManagerHost | undefined;
  statuses: readonly WorkspaceStatusDefinition[];
  draft: WorkspaceStatusManagerDraft | null;
  pending: boolean;
  error: string | null;
  canSave: boolean;
}

export interface WorkspaceStatusManagerDependencies {
  create: (input: { serverId: string; name: string; color: StatusColor }) => Promise<unknown>;
  update: (input: {
    serverId: string;
    id: string;
    name?: string;
    color?: StatusColor;
  }) => Promise<unknown>;
  delete: (input: { serverId: string; id: string }) => Promise<unknown>;
}

/** A row of the manager's list. `id` is the status group id the sidebar and kanban order by. */
export interface WorkspaceStatusManagerEntry {
  id: string;
  label: string;
  leading: PrStatusGroupLeading;
  /** The custom status behind the row; automatic statuses have none and cannot be edited. */
  status: WorkspaceStatusDefinition | null;
}

/** The automatic statuses and one host's custom statuses, in the shared status order. */
export function buildWorkspaceStatusManagerEntries(
  statuses: readonly WorkspaceStatusDefinition[],
  statusOrder: readonly string[],
  t: TFunction,
): WorkspaceStatusManagerEntry[] {
  const entries: WorkspaceStatusManagerEntry[] = [
    ...PR_STATUS_BUCKET_ORDER.map((bucket) => ({
      id: bucket,
      label: getPrStatusBucketLabel(bucket, t),
      leading: { kind: "auto", bucket } as const,
      status: null,
    })),
    ...statuses.map((status) => ({
      id: customPrStatusGroupId(status),
      label: status.name,
      leading: { kind: "custom", color: status.color } as const,
      status,
    })),
  ];
  return orderBoardColumns(entries, statusOrder);
}

/**
 * The full status order once `ids`, the rows one host's manager shows, take their new order.
 * Statuses only other hosts have keep their place, so reordering one host never shuffles them.
 */
export function reorderWorkspaceStatuses(input: {
  catalogs: WorkspaceStatusCatalogs;
  statusOrder: readonly string[];
  ids: readonly string[];
  t: TFunction;
}): string[] {
  const allIds = orderBoardColumns(
    buildAllPrStatusGroups([], new Map(), input.catalogs, input.t),
    input.statusOrder,
  ).map((group) => group.id);
  const known = new Set(allIds);
  const moved = input.ids.filter((id) => known.has(id));
  const members = new Set(moved);
  let next = 0;
  return allIds.map((id) => (members.has(id) ? moved[next++] : id));
}

/** The colour a new status takes until you say otherwise. */
const DEFAULT_COLOR: StatusColor = WORKSPACE_LABEL_COLORS[0];

export function workspaceStatusErrorMessage(cause: unknown): string {
  const code = cause instanceof Error && "code" in cause ? cause.code : undefined;
  if (code === "status_name_taken") return i18n.t("workspaceStatuses.errors.nameTaken");
  if (code === "status_name_empty") return i18n.t("workspaceStatuses.errors.nameEmpty");
  return i18n.t("workspaceStatuses.errors.update");
}

/**
 * One host's custom status catalog and the single draft being created or edited.
 *
 * Plain TypeScript per docs/forms.md: the sheet renders `snapshot()` and dispatches commands.
 * Late host data arrives through `syncHosts`; it never resets a draft in progress.
 */
export class WorkspaceStatusManagerModel {
  private hosts: readonly WorkspaceStatusManagerHost[] = [];
  private serverId: string | null = null;
  private draft: WorkspaceStatusManagerDraft | null = null;
  private pending = false;
  private error: string | null = null;
  private current: WorkspaceStatusManagerSnapshot = this.build();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly dependencies: WorkspaceStatusManagerDependencies) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): WorkspaceStatusManagerSnapshot => this.current;

  syncHosts(hosts: readonly WorkspaceStatusManagerHost[]): void {
    this.hosts = hosts;
    if (!hosts.some((host) => host.serverId === this.serverId)) {
      this.serverId =
        hosts.find((host) => host.status === "online")?.serverId ?? hosts[0]?.serverId ?? null;
    }
    this.publish();
  }

  selectHost(serverId: string): void {
    if (this.pending || serverId === this.serverId) return;
    this.serverId = serverId;
    this.draft = null;
    this.error = null;
    this.publish();
  }

  startCreate(): void {
    if (this.pending) return;
    this.draft = { mode: "create", name: "", color: DEFAULT_COLOR };
    this.error = null;
    this.publish();
  }

  edit(status: WorkspaceStatusDefinition): void {
    if (this.pending) return;
    this.draft = { mode: "edit", original: status, name: status.name, color: status.color };
    this.error = null;
    this.publish();
  }

  cancelEdit(): void {
    if (this.pending) return;
    this.draft = null;
    this.error = null;
    this.publish();
  }

  setDraftName(name: string): void {
    if (!this.draft) return;
    this.draft = { ...this.draft, name };
    this.publish();
  }

  setDraftColor(color: StatusColor): void {
    if (!this.draft) return;
    this.draft = { ...this.draft, color };
    this.publish();
  }

  async save(): Promise<void> {
    const { draft, serverId } = this;
    if (!draft || !serverId || !this.current.canSave) return;
    const name = normalizeWorkspaceLabelName(draft.name);
    await this.run(() =>
      draft.mode === "create"
        ? this.dependencies.create({ serverId, name, color: draft.color })
        : this.dependencies.update({
            serverId,
            id: draft.original.id,
            ...(name === draft.original.name ? {} : { name }),
            ...(draft.color === draft.original.color ? {} : { color: draft.color }),
          }),
    );
  }

  /** Deletes the status being edited once `confirm` resolves true. */
  async delete(confirm: () => Promise<boolean>): Promise<void> {
    const { draft, serverId } = this;
    if (!draft || draft.mode !== "edit" || !serverId || this.pending) return;
    if (!(await confirm())) return;
    await this.run(() => this.dependencies.delete({ serverId, id: draft.original.id }));
  }

  reset(): void {
    this.draft = null;
    this.pending = false;
    this.error = null;
    this.publish();
  }

  private async run(operation: () => Promise<unknown>): Promise<void> {
    this.pending = true;
    this.error = null;
    this.publish();
    try {
      await operation();
      this.draft = null;
    } catch (cause) {
      this.error = workspaceStatusErrorMessage(cause);
    } finally {
      this.pending = false;
      this.publish();
    }
  }

  private build(): WorkspaceStatusManagerSnapshot {
    const host = this.hosts.find((candidate) => candidate.serverId === this.serverId);
    const draft = this.draft;
    const name = draft ? normalizeWorkspaceLabelName(draft.name) : "";
    const changed =
      draft?.mode === "create" ||
      (draft?.mode === "edit" &&
        (name !== draft.original.name || draft.color !== draft.original.color));
    return {
      serverId: this.serverId,
      host,
      statuses: host?.statuses ?? [],
      draft,
      pending: this.pending,
      error: this.error,
      canSave: host?.status === "online" && !this.pending && name.length > 0 && changed,
    };
  }

  private publish(): void {
    this.current = this.build();
    for (const listener of this.listeners) listener();
  }
}
