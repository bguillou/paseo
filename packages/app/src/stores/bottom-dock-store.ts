import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export const BOTTOM_DOCK_DEFAULT_HEIGHT = 260;
export const BOTTOM_DOCK_MIN_HEIGHT = 120;
export const BOTTOM_DOCK_MAX_HEIGHT = 900;

interface WorkspaceBottomDockState {
  /** Dock height is shared across every workspace; only the collapsed state stays per workspace. */
  height: number;
  collapsedByWorkspace: Record<string, boolean>;
  setHeight: (height: number) => void;
  setCollapsed: (workspaceKey: string, collapsed: boolean) => void;
}

const WorkspaceBottomDockSchema = z.strictObject({
  height: z.number().optional(),
  // COMPAT(bottomDockGlobalHeight): height used to be stored per workspace; `merge` collapses this
  // map into the shared `height`. Remove after 2027-08-25.
  heightByWorkspace: z.record(z.string(), z.number()).optional(),
  collapsedByWorkspace: z.record(z.string(), z.boolean()),
});

function clampHeight(height: number): number {
  if (!Number.isFinite(height)) {
    return BOTTOM_DOCK_DEFAULT_HEIGHT;
  }
  return Math.min(BOTTOM_DOCK_MAX_HEIGHT, Math.max(BOTTOM_DOCK_MIN_HEIGHT, height));
}

function collapseDockHeight(heightsByWorkspace: Record<string, number>): number {
  for (const height of Object.values(heightsByWorkspace)) {
    if (Number.isFinite(height) && height > 0) {
      return clampHeight(height);
    }
  }
  return BOTTOM_DOCK_DEFAULT_HEIGHT;
}

export function createWorkspaceBottomDockStore(storage: StateStorage) {
  return create<WorkspaceBottomDockState>()(
    persist<WorkspaceBottomDockState, [], [], z.infer<typeof WorkspaceBottomDockSchema>>(
      (set) => ({
        height: BOTTOM_DOCK_DEFAULT_HEIGHT,
        collapsedByWorkspace: {},
        setHeight: (height) => {
          set({ height: clampHeight(height) });
        },
        setCollapsed: (workspaceKey, collapsed) => {
          const key = workspaceKey.trim();
          if (!key) return;
          set((state) => ({
            collapsedByWorkspace: { ...state.collapsedByWorkspace, [key]: collapsed },
          }));
        },
      }),
      {
        name: "workspace-bottom-dock",
        // Height moved from a per-workspace map to a shared scalar, but the version stays 1: this
        // store has no `migrate`, and bumping without one makes zustand discard the stored state
        // instead of handing it to `merge`. The schema below accepts both shapes, and `merge`
        // collapses the old map, so old blobs upgrade without losing the user's height.
        version: 1,
        storage: createValidatedPersistStorage(storage, WorkspaceBottomDockSchema),
        partialize: (state) => ({
          height: state.height,
          collapsedByWorkspace: state.collapsedByWorkspace,
        }),
        merge: (persistedState, currentState) => {
          const result = WorkspaceBottomDockSchema.safeParse(persistedState);
          if (!result.success) {
            return currentState;
          }
          return {
            ...currentState,
            height: result.data.height ?? collapseDockHeight(result.data.heightByWorkspace ?? {}),
            collapsedByWorkspace: result.data.collapsedByWorkspace,
          };
        },
      },
    ),
  );
}

export const useWorkspaceBottomDockStore = createWorkspaceBottomDockStore(AsyncStorage);

export function useBottomDockHeight(): number {
  return useWorkspaceBottomDockStore((state) => state.height);
}

export function useBottomDockCollapsed(workspaceKey: string): boolean {
  return useWorkspaceBottomDockStore((state) => state.collapsedByWorkspace[workspaceKey] ?? false);
}
