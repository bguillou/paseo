import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { WorkspaceManualStatus, WorkspaceStatusDefinition } from "@getpaseo/protocol/messages";
import { useMemo } from "react";
import { create } from "zustand";
import { i18n } from "@/i18n/i18next";

export interface WorkspaceStatusHostSnapshot {
  serverId: string;
  statuses: WorkspaceStatusDefinition[];
  status: "offline" | "online" | "unsupported";
  error: string | null;
}

interface WorkspaceStatusState {
  hosts: Record<string, WorkspaceStatusHostSnapshot>;
  setHost: (host: WorkspaceStatusHostSnapshot) => void;
}

export const useWorkspaceStatuses = create<WorkspaceStatusState>((set) => ({
  hosts: {},
  setHost: (host) => set((state) => ({ hosts: { ...state.hosts, [host.serverId]: host } })),
}));

/** Custom status catalogs keyed by serverId. A workspace resolves against its own host only. */
export type WorkspaceStatusCatalogs = Readonly<
  Record<string, readonly WorkspaceStatusDefinition[]>
>;

export function selectWorkspaceStatusCatalogs(
  hosts: Readonly<Record<string, WorkspaceStatusHostSnapshot>>,
): WorkspaceStatusCatalogs {
  return Object.fromEntries(
    Object.values(hosts).map((host) => [host.serverId, host.statuses] as const),
  );
}

export function useWorkspaceStatusCatalogs(): WorkspaceStatusCatalogs {
  const hosts = useWorkspaceStatuses((state) => state.hosts);
  return useMemo(() => selectWorkspaceStatusCatalogs(hosts), [hosts]);
}

export function useWorkspaceStatusHost(serverId: string): WorkspaceStatusHostSnapshot | undefined {
  return useWorkspaceStatuses((state) => state.hosts[serverId]);
}

interface HostConnection {
  client: DaemonClient;
  release: () => void;
}

class WorkspaceStatusesController {
  private readonly connections = new Map<string, HostConnection>();

  async connect(input: {
    serverId: string;
    client: DaemonClient;
    supportsWorkspaceStatuses: boolean;
  }): Promise<void> {
    const existing = this.connections.get(input.serverId);
    if (existing?.client === input.client && input.supportsWorkspaceStatuses) return;
    this.disconnect(input.serverId);
    if (!input.supportsWorkspaceStatuses) {
      this.publish(input.serverId, "unsupported", null);
      return;
    }

    const subscription = input.client.observeWorkspaceStatuses();
    this.connections.set(input.serverId, {
      client: input.client,
      release: () => {
        void subscription.release().catch(() => undefined);
      },
    });
    subscription.subscribe({
      snapshot: (payload) => this.publish(input.serverId, "online", null, payload.statuses),
      update: (message) => {
        if (message.type !== "workspace.status.catalog.changed") return;
        this.publish(input.serverId, "online", null, message.payload.statuses);
      },
      error: (error) => {
        this.publish(
          input.serverId,
          "online",
          error instanceof Error ? error.message : i18n.t("workspaceStatuses.errors.load"),
        );
      },
    });
    await subscription.ready;
  }

  disconnect(serverId: string): void {
    this.connections.get(serverId)?.release();
    this.connections.delete(serverId);
    if (useWorkspaceStatuses.getState().hosts[serverId]) this.publish(serverId, "offline", null);
  }

  async setManualStatus(input: {
    serverId: string;
    workspaceId: string;
    manualStatus: WorkspaceManualStatus | null;
  }) {
    return this.requireClient(input.serverId).setWorkspaceManualStatus(input);
  }

  async create(input: {
    serverId: string;
    name: string;
    color: WorkspaceStatusDefinition["color"];
  }) {
    return this.requireClient(input.serverId).createWorkspaceStatus(input);
  }

  async update(input: {
    serverId: string;
    id: string;
    name?: string;
    color?: WorkspaceStatusDefinition["color"];
  }) {
    return this.requireClient(input.serverId).updateWorkspaceStatus(input);
  }

  async delete(input: { serverId: string; id: string }) {
    return this.requireClient(input.serverId).deleteWorkspaceStatus(input);
  }

  private requireClient(serverId: string): DaemonClient {
    const connection = this.connections.get(serverId);
    if (!connection) throw new Error(i18n.t("workspaceStatuses.errors.update"));
    return connection.client;
  }

  /** Keeps the last catalog across offline/error so rows keep their custom status meanwhile. */
  private publish(
    serverId: string,
    status: WorkspaceStatusHostSnapshot["status"],
    error: string | null,
    statuses?: WorkspaceStatusDefinition[],
  ): void {
    const state = useWorkspaceStatuses.getState();
    state.setHost({
      serverId,
      statuses: statuses ?? state.hosts[serverId]?.statuses ?? [],
      status,
      error,
    });
  }
}

export const workspaceStatuses = new WorkspaceStatusesController();
