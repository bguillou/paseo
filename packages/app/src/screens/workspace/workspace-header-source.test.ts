import { describe, expect, it } from "vitest";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { resolveWorkspaceHeaderRenderState } from "./workspace-header-source";

const workspace = {
  name: "feature",
  projectDisplayName: "repo",
} as unknown as WorkspaceDescriptor;

describe("resolveWorkspaceHeaderRenderState base branch", () => {
  it("surfaces the base branch and worktree flag from a ready worktree checkout", () => {
    const state = resolveWorkspaceHeaderRenderState({
      workspace,
      checkoutState: {
        kind: "ready",
        checkout: {
          isGit: true,
          currentBranch: "feature",
          baseRef: "main",
          isPaseoOwnedWorktree: true,
        },
      },
    });

    expect(state).toMatchObject({
      kind: "ready",
      baseBranchName: "main",
      isPaseoOwnedWorktree: true,
    });
  });

  it("leaves the base branch null when the checkout is not git", () => {
    const state = resolveWorkspaceHeaderRenderState({
      workspace,
      checkoutState: {
        kind: "ready",
        checkout: {
          isGit: false,
          currentBranch: null,
          baseRef: null,
          isPaseoOwnedWorktree: false,
        },
      },
    });

    expect(state).toMatchObject({
      kind: "ready",
      baseBranchName: null,
      isPaseoOwnedWorktree: false,
    });
  });
});
