import { describe, expect, it } from "vitest";
import type { WorkspaceSetupSnapshot } from "@/stores/workspace-setup-store";
import { resolveSetupViewState } from "./setup-panel-state";

type SetupCommand = WorkspaceSetupSnapshot["detail"]["commands"][number];

function makeSnapshot(
  status: WorkspaceSetupSnapshot["status"],
  overrides: { commands?: SetupCommand[]; log?: string; error?: string | null } = {},
): WorkspaceSetupSnapshot {
  return {
    workspaceId: "workspace-1",
    status,
    detail: {
      type: "worktree_setup",
      worktreePath: "/Users/test/project",
      branchName: "main",
      log: overrides.log ?? "",
      commands: overrides.commands ?? [],
    },
    error: overrides.error ?? null,
    updatedAt: 0,
  };
}

const RUNNING_COMMAND: SetupCommand = {
  index: 1,
  command: "npm install",
  cwd: "/Users/test/project",
  log: "",
  status: "running",
  exitCode: null,
};

describe("resolveSetupViewState", () => {
  it("waits while the status request is still in flight", () => {
    expect(resolveSetupViewState({ snapshot: null, fetchSettled: false })).toEqual({
      kind: "waiting",
    });
  });

  it("reports that setup never ran once the request settles with no snapshot", () => {
    expect(resolveSetupViewState({ snapshot: null, fetchSettled: true })).toEqual({
      kind: "notRun",
    });
  });

  it("waits for output while setup runs with no command reported yet", () => {
    expect(
      resolveSetupViewState({ snapshot: makeSnapshot("running"), fetchSettled: true }),
    ).toEqual({ kind: "waiting" });
  });

  it("reports an empty completed run as having no commands", () => {
    expect(
      resolveSetupViewState({ snapshot: makeSnapshot("completed"), fetchSettled: true }),
    ).toEqual({ kind: "noCommands" });
  });

  it("shows the command list when commands are reported", () => {
    expect(
      resolveSetupViewState({
        snapshot: makeSnapshot("running", { commands: [RUNNING_COMMAND] }),
        fetchSettled: true,
      }),
    ).toEqual({ kind: "commands" });
  });

  it("shows the log when a completed run has output but no commands", () => {
    expect(
      resolveSetupViewState({
        snapshot: makeSnapshot("completed", { log: "done\n" }),
        fetchSettled: true,
      }),
    ).toEqual({ kind: "commands" });
  });

  it("surfaces a blocked run with its source", () => {
    const source = {
      kind: "change_request" as const,
      forge: "github",
      number: 12,
      headRepository: "fork/repo",
    };
    expect(
      resolveSetupViewState({
        snapshot: { ...makeSnapshot("blocked"), blockedSource: source },
        fetchSettled: true,
      }),
    ).toEqual({ kind: "blocked", source });
  });
});
