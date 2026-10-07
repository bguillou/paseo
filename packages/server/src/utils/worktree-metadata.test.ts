import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readPaseoWorktreeMetadata,
  updatePaseoWorktreeBaseRef,
  writePaseoWorktreeMetadata,
} from "./worktree-metadata.js";

describe("updatePaseoWorktreeBaseRef", () => {
  let worktreeRoot: string;

  beforeEach(() => {
    worktreeRoot = mkdtempSync(join(tmpdir(), "paseo-worktree-meta-"));
    // A normal checkout has a `.git` directory; the metadata lives under it.
    mkdirSync(join(worktreeRoot, ".git"), { recursive: true });
  });

  afterEach(() => {
    rmSync(worktreeRoot, { recursive: true, force: true });
  });

  it("re-points the base ref while preserving the change-request hint", () => {
    writePaseoWorktreeMetadata(worktreeRoot, {
      baseRefName: "main",
      baseRef: "refs/heads/main",
      changeRequestLookupTarget: { headRef: "feature", localBranchName: "feature" },
    });

    const updated = updatePaseoWorktreeBaseRef(worktreeRoot, {
      baseRefName: "develop",
      baseRef: "refs/remotes/origin/develop",
    });

    expect(updated.baseRefName).toBe("develop");
    expect(updated.baseRef).toBe("refs/remotes/origin/develop");
    expect(updated.changeRequestLookupTarget).toEqual({
      headRef: "feature",
      localBranchName: "feature",
    });

    // Persisted to disk, not just returned.
    const reread = readPaseoWorktreeMetadata(worktreeRoot);
    expect(reread?.baseRefName).toBe("develop");
    expect(reread?.baseRef).toBe("refs/remotes/origin/develop");
  });

  it("throws when there is no existing worktree metadata", () => {
    expect(() =>
      updatePaseoWorktreeBaseRef(worktreeRoot, {
        baseRefName: "develop",
        baseRef: "refs/remotes/origin/develop",
      }),
    ).toThrow(/missing base metadata/i);
  });
});
