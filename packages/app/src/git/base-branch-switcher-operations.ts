import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";

// Binds the base-branch selector's git operations to a single workspace directory, so a
// workspace id can never be passed where a cwd is expected. `cwd` is set once here; callers
// choose the operation, never the directory. Re-pointing the base is non-destructive — it
// changes the stored base ref used for diff/ahead-behind/merge/PR, not the branch history.
export function createBaseBranchSwitcherOperations(client: DaemonClient, cwd: string) {
  return {
    getBranchSuggestions: (limit: number) => client.getBranchSuggestions({ cwd, limit }),
    setBaseRef: (baseRefName: string) => client.setCheckoutBaseRef({ cwd, baseRefName }),
  };
}

export type BaseBranchSwitcherOperations = ReturnType<typeof createBaseBranchSwitcherOperations>;
