import { beforeEach, describe, expect, it } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BOTTOM_DOCK_DEFAULT_HEIGHT,
  BOTTOM_DOCK_MAX_HEIGHT,
  BOTTOM_DOCK_MIN_HEIGHT,
  createWorkspaceBottomDockStore,
} from "./bottom-dock-store";

const STORAGE_KEY = "workspace-bottom-dock";

describe("bottom-dock-store", () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
  });

  it("shares one height across every workspace instead of keying it by workspace", () => {
    const store = createWorkspaceBottomDockStore(AsyncStorage);
    store.getState().setHeight(420);
    expect(store.getState().height).toBe(420);
  });

  it("clamps the height to the allowed range", () => {
    const store = createWorkspaceBottomDockStore(AsyncStorage);
    store.getState().setHeight(BOTTOM_DOCK_MAX_HEIGHT + 1000);
    expect(store.getState().height).toBe(BOTTOM_DOCK_MAX_HEIGHT);
    store.getState().setHeight(1);
    expect(store.getState().height).toBe(BOTTOM_DOCK_MIN_HEIGHT);
  });

  it("keeps the collapsed state per workspace", () => {
    const store = createWorkspaceBottomDockStore(AsyncStorage);
    store.getState().setCollapsed("server:one", true);
    expect(store.getState().collapsedByWorkspace["server:one"]).toBe(true);
    expect(store.getState().collapsedByWorkspace["server:two"]).toBeUndefined();
  });

  it("collapses a legacy per-workspace height map into the shared scalar on rehydrate", async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          heightByWorkspace: { "server:one": 480, "server:two": 300 },
          collapsedByWorkspace: { "server:one": true },
        },
        version: 1,
      }),
    );
    const store = createWorkspaceBottomDockStore(AsyncStorage);
    await store.persist.rehydrate();
    expect(store.getState().height).toBe(480);
    // Collapsed state stays per workspace.
    expect(store.getState().collapsedByWorkspace).toEqual({ "server:one": true });
  });

  it("falls back to the default height when no legacy value is usable", async () => {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { heightByWorkspace: {}, collapsedByWorkspace: {} },
        version: 1,
      }),
    );
    const store = createWorkspaceBottomDockStore(AsyncStorage);
    await store.persist.rehydrate();
    expect(store.getState().height).toBe(BOTTOM_DOCK_DEFAULT_HEIGHT);
  });
});
