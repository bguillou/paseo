import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";
import pino from "pino";
import { ProjectConfigSession, type ProjectConfigSessionHost } from "./project-config-session.js";
import { resolvePaseoConfigPath, statPaseoConfigPath } from "../../../utils/paseo-config-file.js";
import { GlobalProjectConfigStore } from "../../project-config/global-project-config-store.js";
import type { PersistedProjectRecord } from "../../workspace-registry.js";
import type { SessionOutboundMessage } from "../../messages.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "project-config-session-test-")));
  tempDirs.push(root);
  return root;
}

function projectRecord(rootPath: string, archivedAt: string | null = null): PersistedProjectRecord {
  return {
    // projectIds are filesystem-safe keys; derive one from the root path.
    projectId: `prj${rootPath.replace(/[^A-Za-z0-9]/g, "")}`,
    rootPath,
    kind: "git",
    displayName: "Project",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt,
  };
}

function makeSubsystem(records: PersistedProjectRecord[]) {
  const emitted: SessionOutboundMessage[] = [];
  const host: ProjectConfigSessionHost = { emit: (msg) => emitted.push(msg) };
  const globalConfigStore = new GlobalProjectConfigStore({
    configDir: join(makeRoot(), "configs"),
  });
  const subsystem = new ProjectConfigSession({
    host,
    projectRegistry: { list: async () => records },
    globalConfigStore,
    logger: pino({ level: "silent" }),
  });
  return { subsystem, emitted, globalConfigStore };
}

describe("ProjectConfigSession", () => {
  test("read reports when the saved worktree setup differs from HEAD", async () => {
    const repoRoot = makeRoot();
    execFileSync("git", ["init", "-b", "main"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoRoot });
    writeFileSync(join(repoRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "npm ci" } }));
    execFileSync("git", ["add", "paseo.json"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "add config"], { cwd: repoRoot });
    writeFileSync(
      join(repoRoot, "paseo.json"),
      JSON.stringify({ worktree: { setup: "npm install" } }),
    );
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "read-uncommitted-setup",
      repoRoot,
    });

    expect(emitted).toEqual([
      {
        type: "read_project_config_response",
        payload: expect.objectContaining({
          requestId: "read-uncommitted-setup",
          ok: true,
          hasUncommittedWorktreeSetupChanges: true,
        }),
      },
    ]);
  });

  test("read resolves a known root despite a trailing slash and returns the raw config + revision", async () => {
    const repoRoot = makeRoot();
    writeFileSync(join(repoRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "npm ci" } }));
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "read-1",
      repoRoot: `${repoRoot}/`,
    });

    expect(emitted).toEqual([
      {
        type: "read_project_config_response",
        payload: {
          requestId: "read-1",
          repoRoot,
          ok: true,
          config: { worktree: { setup: "npm ci" } },
          revision: expect.objectContaining({
            mtimeMs: expect.any(Number),
            size: expect.any(Number),
          }),
          source: "project_file",
        },
      },
    ]);
  });

  // POSIX-only: creates a directory symlink without Windows privileges.
  test.skipIf(process.platform === "win32")(
    "read resolves a symlink to an active root via realpath",
    async () => {
      const repoRoot = makeRoot();
      writeFileSync(
        join(repoRoot, "paseo.json"),
        JSON.stringify({ worktree: { setup: "npm ci" } }),
      );
      const linkRoot = join(makeRoot(), "link");
      symlinkSync(repoRoot, linkRoot, "dir");
      const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

      await subsystem.handleReadProjectConfigRequest({
        type: "read_project_config_request",
        requestId: "read-symlink-1",
        repoRoot: linkRoot,
      });

      expect(emitted).toEqual([
        {
          type: "read_project_config_response",
          payload: {
            requestId: "read-symlink-1",
            repoRoot,
            ok: true,
            config: { worktree: { setup: "npm ci" } },
            revision: expect.objectContaining({
              mtimeMs: expect.any(Number),
              size: expect.any(Number),
            }),
            source: "project_file",
          },
        },
      ]);
    },
  );

  test("read rejects archived and unknown roots with project_not_found", async () => {
    const archivedRoot = makeRoot();
    const unknownRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([
      projectRecord(archivedRoot, "2026-01-02T00:00:00.000Z"),
    ]);

    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "archived-1",
      repoRoot: archivedRoot,
    });
    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "unknown-1",
      repoRoot: unknownRoot,
    });

    expect(emitted).toEqual([
      {
        type: "read_project_config_response",
        payload: {
          requestId: "archived-1",
          repoRoot: archivedRoot,
          ok: false,
          error: { code: "project_not_found" },
        },
      },
      {
        type: "read_project_config_response",
        payload: {
          requestId: "unknown-1",
          repoRoot: unknownRoot,
          ok: false,
          error: { code: "project_not_found" },
        },
      },
    ]);
  });

  test("write round-trips a config to a known root and echoes the new revision", async () => {
    const repoRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "write-1",
      repoRoot,
      config: { worktree: { setup: "npm ci" } },
      expectedRevision: null,
    });

    expect(emitted).toEqual([
      {
        type: "write_project_config_response",
        payload: {
          requestId: "write-1",
          repoRoot,
          ok: true,
          config: { worktree: { setup: "npm ci" } },
          revision: expect.objectContaining({
            mtimeMs: expect.any(Number),
            size: expect.any(Number),
          }),
          source: "project_file",
        },
      },
    ]);
  });

  test("write recomputes the worktree setup commit status", async () => {
    const repoRoot = makeRoot();
    execFileSync("git", ["init", "-b", "main"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoRoot });
    writeFileSync(join(repoRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "npm ci" } }));
    execFileSync("git", ["add", "paseo.json"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-m", "add config"], { cwd: repoRoot });
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "write-uncommitted-setup",
      repoRoot,
      config: { worktree: { setup: "npm install" } },
      expectedRevision: statPaseoConfigPath(repoRoot),
    });

    expect(emitted).toEqual([
      {
        type: "write_project_config_response",
        payload: expect.objectContaining({
          requestId: "write-uncommitted-setup",
          ok: true,
          hasUncommittedWorktreeSetupChanges: true,
        }),
      },
    ]);
  });

  test("write rejects a stale revision and an unknown root with their inline domain failures", async () => {
    const staleRoot = makeRoot();
    writeFileSync(join(staleRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "old" } }));
    const unknownRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(staleRoot)]);

    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "stale-1",
      repoRoot: staleRoot,
      config: { worktree: { setup: "new" } },
      expectedRevision: { mtimeMs: 1, size: 1 },
    });
    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "unknown-write-1",
      repoRoot: unknownRoot,
      config: { worktree: { setup: "new" } },
      expectedRevision: null,
    });

    expect(emitted).toEqual([
      {
        type: "write_project_config_response",
        payload: {
          requestId: "stale-1",
          repoRoot: staleRoot,
          ok: false,
          error: {
            code: "stale_project_config",
            currentRevision: expect.objectContaining({
              mtimeMs: expect.any(Number),
              size: expect.any(Number),
            }),
          },
        },
      },
      {
        type: "write_project_config_response",
        payload: {
          requestId: "unknown-write-1",
          repoRoot: unknownRoot,
          ok: false,
          error: { code: "project_not_found" },
        },
      },
    ]);
  });

  test("global write stores in PASEO_HOME without touching the committed file, and global read returns it", async () => {
    const repoRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleWriteProjectConfigRequest({
      type: "write_project_config_request",
      requestId: "write-global-1",
      repoRoot,
      config: { worktree: { setup: "global install" } },
      expectedRevision: null,
      target: "global",
    });

    // No committed paseo.json was created on disk.
    expect(existsSync(resolvePaseoConfigPath(repoRoot))).toBe(false);
    expect(emitted[0]).toEqual({
      type: "write_project_config_response",
      payload: expect.objectContaining({
        requestId: "write-global-1",
        ok: true,
        config: { worktree: { setup: "global install" } },
        source: "global",
      }),
    });
    // The global response must not carry a committed-file setup comparison.
    const written = emitted[0];
    if (written.type === "write_project_config_response" && written.payload.ok) {
      expect(written.payload.hasUncommittedWorktreeSetupChanges).toBeUndefined();
    }

    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "read-global-1",
      repoRoot,
      source: "global",
    });

    expect(emitted[1]).toEqual({
      type: "read_project_config_response",
      payload: expect.objectContaining({
        requestId: "read-global-1",
        ok: true,
        config: { worktree: { setup: "global install" } },
        source: "global",
      }),
    });
  });

  test("effective read prefers the committed file over the global layer", async () => {
    const repoRoot = makeRoot();
    writeFileSync(
      join(repoRoot, "paseo.json"),
      JSON.stringify({ worktree: { setup: "from file" } }),
    );
    const { subsystem, emitted, globalConfigStore } = makeSubsystem([projectRecord(repoRoot)]);
    globalConfigStore.write({
      projectId: projectRecord(repoRoot).projectId,
      config: { worktree: { setup: "from global" } },
      expectedRevision: null,
    });

    await subsystem.handleReadProjectConfigRequest({
      type: "read_project_config_request",
      requestId: "read-effective-1",
      repoRoot,
      source: "effective",
    });

    expect(emitted[0]).toEqual({
      type: "read_project_config_response",
      payload: expect.objectContaining({
        requestId: "read-effective-1",
        ok: true,
        config: { worktree: { setup: "from file" } },
        source: "project_file",
      }),
    });
  });

  test("migrate copies the committed config into the global layer", async () => {
    const repoRoot = makeRoot();
    writeFileSync(join(repoRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "npm ci" } }));
    const { subsystem, emitted, globalConfigStore } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleMigrateProjectConfigToGlobalRequest({
      type: "project.config.migrateToGlobal.request",
      requestId: "migrate-1",
      repoRoot,
    });

    expect(emitted[0]).toEqual({
      type: "project.config.migrateToGlobal.response",
      payload: expect.objectContaining({
        requestId: "migrate-1",
        ok: true,
        config: { worktree: { setup: "npm ci" } },
      }),
    });
    // The committed file is left in place (deletion is a separate step).
    expect(existsSync(resolvePaseoConfigPath(repoRoot))).toBe(true);
    expect(globalConfigStore.readForEdit(projectRecord(repoRoot).projectId).config).toEqual({
      worktree: { setup: "npm ci" },
    });
  });

  test("migrate fails with invalid_project_config when there is no committed file", async () => {
    const repoRoot = makeRoot();
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleMigrateProjectConfigToGlobalRequest({
      type: "project.config.migrateToGlobal.request",
      requestId: "migrate-missing-1",
      repoRoot,
    });

    expect(emitted[0]).toEqual({
      type: "project.config.migrateToGlobal.response",
      payload: {
        requestId: "migrate-missing-1",
        repoRoot,
        ok: false,
        error: { code: "invalid_project_config" },
      },
    });
  });

  test("delete removes the committed paseo.json from the working tree", async () => {
    const repoRoot = makeRoot();
    writeFileSync(join(repoRoot, "paseo.json"), JSON.stringify({ worktree: { setup: "npm ci" } }));
    const { subsystem, emitted } = makeSubsystem([projectRecord(repoRoot)]);

    await subsystem.handleDeleteProjectConfigFileRequest({
      type: "project.config.deleteProjectFile.request",
      requestId: "delete-1",
      repoRoot,
    });

    expect(existsSync(resolvePaseoConfigPath(repoRoot))).toBe(false);
    expect(emitted[0]).toEqual({
      type: "project.config.deleteProjectFile.response",
      payload: { requestId: "delete-1", repoRoot, ok: true },
    });
  });
});
