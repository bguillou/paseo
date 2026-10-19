import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { WorkspaceStatusDefinition } from "@getpaseo/protocol/messages";
import { createTestLogger } from "../test-utils/test-logger.js";
import {
  createPersistedWorkspaceRecord,
  FileBackedWorkspaceRegistry,
} from "./workspace-registry.js";
import { WorkspaceStatusError, WorkspaceStatusService } from "./workspace-status-service.js";

describe("WorkspaceStatusService", () => {
  let paseoHome: string;
  let registry: FileBackedWorkspaceRegistry;
  let nextId: number;

  function createService(): WorkspaceStatusService {
    return new WorkspaceStatusService({
      filePath: join(paseoHome, "projects", "workspace-statuses.json"),
      workspaceRegistry: registry,
      createId: () => `sts_${++nextId}`,
    });
  }

  async function addWorkspace(workspaceId: string, archivedAt?: string) {
    await registry.upsert(
      createPersistedWorkspaceRecord({
        workspaceId,
        projectId: "prj_one",
        cwd: `/repo/${workspaceId}`,
        kind: "worktree",
        displayName: workspaceId,
        createdAt: "2026-10-19T00:00:00.000Z",
        updatedAt: "2026-10-19T00:00:00.000Z",
        archivedAt,
      }),
    );
  }

  beforeEach(async () => {
    paseoHome = await mkdtemp(join(tmpdir(), "paseo-statuses-"));
    nextId = 0;
    registry = new FileBackedWorkspaceRegistry(
      join(paseoHome, "projects", "workspaces.json"),
      createTestLogger(),
    );
    await addWorkspace("wks_one");
    await addWorkspace("wks_two");
  });

  afterEach(async () => {
    await rm(paseoHome, { recursive: true, force: true });
  });

  test("creates statuses with normalized names and persists them across restarts", async () => {
    const statuses = createService();
    const blocked = await statuses.create({ name: "  Blocked   on  QA ", color: "red" });

    expect(blocked).toEqual({ id: "sts_1", name: "Blocked on QA", color: "red" });
    expect(await createService().list()).toEqual([blocked]);
  });

  test("rejects empty and case-insensitively duplicated names", async () => {
    const statuses = createService();
    await statuses.create({ name: "Blocked", color: "red" });

    await expect(statuses.create({ name: "   ", color: "red" })).rejects.toMatchObject({
      code: "status_name_empty",
    });
    await expect(statuses.create({ name: "blocked", color: "sky" })).rejects.toMatchObject({
      code: "status_name_taken",
    });
  });

  test("renames and recolours by id without touching assigned workspaces", async () => {
    const statuses = createService();
    const blocked = await statuses.create({ name: "Blocked", color: "red" });
    await statuses.setAssignment({
      workspaceId: "wks_one",
      manualStatus: { statusId: blocked.id, baseline: "in_progress" },
    });
    const before = await registry.get("wks_one");

    const renamed = await statuses.update({ id: blocked.id, name: "Waiting", color: "amber" });

    expect(renamed).toEqual({ id: blocked.id, name: "Waiting", color: "amber" });
    expect(await registry.get("wks_one")).toEqual(before);
  });

  test("allows a case-only rename of the same status", async () => {
    const statuses = createService();
    const blocked = await statuses.create({ name: "blocked", color: "red" });

    await expect(statuses.update({ id: blocked.id, name: "Blocked" })).resolves.toEqual({
      ...blocked,
      name: "Blocked",
    });
  });

  test("assigns custom and auto statuses, then clears them", async () => {
    const statuses = createService();
    const blocked = await statuses.create({ name: "Blocked", color: "red" });

    await expect(
      statuses.setAssignment({
        workspaceId: "wks_one",
        manualStatus: { statusId: blocked.id, baseline: "in_review" },
      }),
    ).resolves.toEqual({ statusId: blocked.id, baseline: "in_review" });
    await statuses.setAssignment({
      workspaceId: "wks_two",
      manualStatus: { statusId: "done", baseline: "in_progress" },
    });
    expect((await registry.get("wks_two"))?.manualStatus).toEqual({
      statusId: "done",
      baseline: "in_progress",
    });

    await expect(
      statuses.setAssignment({ workspaceId: "wks_one", manualStatus: null }),
    ).resolves.toBeNull();
    expect((await registry.get("wks_one"))?.manualStatus).toBeUndefined();
  });

  test("rejects unknown statuses and missing or archived workspaces", async () => {
    await addWorkspace("wks_archived", "2026-10-19T01:00:00.000Z");
    const statuses = createService();

    await expect(
      statuses.setAssignment({
        workspaceId: "wks_one",
        manualStatus: { statusId: "sts_unknown", baseline: "backlog" },
      }),
    ).rejects.toMatchObject({ code: "status_not_found" });
    for (const workspaceId of ["wks_missing", "wks_archived"]) {
      await expect(
        statuses.setAssignment({
          workspaceId,
          manualStatus: { statusId: "done", baseline: "backlog" },
        }),
      ).rejects.toBeInstanceOf(WorkspaceStatusError);
    }
    expect((await registry.get("wks_archived"))?.manualStatus).toBeUndefined();
  });

  test("deleting a status clears only the workspaces assigned to it", async () => {
    const statuses = createService();
    const blocked = await statuses.create({ name: "Blocked", color: "red" });
    const qa = await statuses.create({ name: "QA", color: "sky" });
    await statuses.setAssignment({
      workspaceId: "wks_one",
      manualStatus: { statusId: blocked.id, baseline: "in_progress" },
    });
    await statuses.setAssignment({
      workspaceId: "wks_two",
      manualStatus: { statusId: qa.id, baseline: "in_progress" },
    });

    await expect(statuses.delete(blocked.id)).resolves.toEqual({ affectedWorkspaceCount: 1 });

    expect(await statuses.list()).toEqual([qa]);
    expect((await registry.get("wks_one"))?.manualStatus).toBeUndefined();
    expect((await registry.get("wks_two"))?.manualStatus).toEqual({
      statusId: qa.id,
      baseline: "in_progress",
    });
  });

  test("observers get the snapshot, then the full catalog after each change", async () => {
    const statuses = createService();
    const pushes: WorkspaceStatusDefinition[][] = [];
    const observed = await statuses.observe((catalog) => pushes.push(catalog));
    expect(observed.statuses).toEqual([]);

    const blocked = await statuses.create({ name: "Blocked", color: "red" });
    await statuses.update({ id: blocked.id, color: "red" });
    await statuses.delete(blocked.id);
    observed.unsubscribe();
    await statuses.create({ name: "Later", color: "sky" });

    expect(pushes).toEqual([[blocked], []]);
  });
});
