import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { GlobalProjectConfigStore } from "./global-project-config-store.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeStore(): GlobalProjectConfigStore {
  const root = mkdtempSync(join(tmpdir(), "global-project-config-store-test-"));
  tempDirs.push(root);
  return new GlobalProjectConfigStore({ configDir: join(root, "configs") });
}

describe("GlobalProjectConfigStore", () => {
  test("reports no config before anything is written", () => {
    const store = makeStore();
    expect(store.exists("prj_abc")).toBe(false);
    expect(store.stat("prj_abc")).toBeNull();
    expect(store.readForEdit("prj_abc")).toEqual({ ok: true, config: null, revision: null });
  });

  test("writes a config and reads it back with a revision", () => {
    const store = makeStore();
    const written = store.write({
      projectId: "prj_abc",
      config: { worktree: { setup: "npm ci" } },
      expectedRevision: null,
    });

    expect(written.ok).toBe(true);
    expect(store.exists("prj_abc")).toBe(true);
    const read = store.readForEdit("prj_abc");
    expect(read).toEqual({
      ok: true,
      config: { worktree: { setup: "npm ci" } },
      revision: expect.objectContaining({ mtimeMs: expect.any(Number), size: expect.any(Number) }),
    });
  });

  test("rejects a stale write with the current revision", () => {
    const store = makeStore();
    store.write({ projectId: "prj_abc", config: { scripts: {} }, expectedRevision: null });

    const result = store.write({
      projectId: "prj_abc",
      config: { scripts: {} },
      expectedRevision: { mtimeMs: 1, size: 1 },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("stale_project_config");
    }
  });

  test("keeps per-project configs isolated by projectId", () => {
    const store = makeStore();
    store.write({
      projectId: "prj_one",
      config: { worktree: { setup: "one" } },
      expectedRevision: null,
    });
    store.write({
      projectId: "prj_two",
      config: { worktree: { setup: "two" } },
      expectedRevision: null,
    });

    expect(store.readForEdit("prj_one").config).toEqual({ worktree: { setup: "one" } });
    expect(store.readForEdit("prj_two").config).toEqual({ worktree: { setup: "two" } });
  });

  test("refuses an unsafe projectId that could escape the configs directory", () => {
    const store = makeStore();
    expect(() => store.exists("../escape")).toThrow();
  });
});
