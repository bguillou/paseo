import type { WorkspaceSetupSnapshot } from "@/stores/workspace-setup-store";

export type SetupViewState =
  | { kind: "waiting" }
  | { kind: "blocked"; source: NonNullable<WorkspaceSetupSnapshot["blockedSource"]> }
  | { kind: "notRun" }
  | { kind: "noCommands" }
  | { kind: "commands" };

export function resolveSetupViewState(input: {
  snapshot: WorkspaceSetupSnapshot | null;
  fetchSettled: boolean;
}): SetupViewState {
  const { snapshot, fetchSettled } = input;
  if (!snapshot) {
    // The daemon answers with no snapshot when setup never ran in its lifetime (a worktree
    // Paseo did not create, a plain checkout, or a restart). That is a final answer, not
    // "still loading", so only an unsettled request keeps the spinner.
    return fetchSettled ? { kind: "notRun" } : { kind: "waiting" };
  }
  if (snapshot.status === "blocked" && snapshot.blockedSource) {
    return { kind: "blocked", source: snapshot.blockedSource };
  }
  const commands = snapshot.detail.commands;
  if (snapshot.status === "running" && commands.length === 0) {
    return { kind: "waiting" };
  }
  if (
    snapshot.status === "completed" &&
    commands.length === 0 &&
    snapshot.detail.log.trim().length === 0
  ) {
    return { kind: "noCommands" };
  }
  return { kind: "commands" };
}
