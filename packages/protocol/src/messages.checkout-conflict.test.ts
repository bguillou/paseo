import { describe, expect, test } from "vitest";

import {
  CheckoutAbortMergeRequestSchema,
  CheckoutAbortMergeResponseSchema,
  CheckoutContinueMergeRequestSchema,
  CheckoutContinueMergeResponseSchema,
  CheckoutStatusResponseSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

function gitStatusPayload(extra: Record<string, unknown>) {
  return {
    type: "checkout_status_response",
    payload: {
      cwd: "/tmp/repo",
      isGit: true,
      isPaseoOwnedWorktree: false,
      repoRoot: "/tmp/repo",
      currentBranch: "feature",
      isDirty: true,
      baseRef: "main",
      aheadBehind: { ahead: 1, behind: 2 },
      upstreamRef: null,
      aheadOfOrigin: null,
      behindOfOrigin: null,
      hasRemote: false,
      remoteUrl: null,
      error: null,
      requestId: "r1",
      ...extra,
    },
  };
}

describe("checkout conflict state schema", () => {
  test("carries conflict paths and operation", () => {
    const parsed = CheckoutStatusResponseSchema.parse(
      gitStatusPayload({ conflictedPaths: ["a.ts", "b.ts"], conflictOperation: "merge" }),
    );
    expect(parsed.payload.isGit).toBe(true);
    if (parsed.payload.isGit) {
      expect(parsed.payload.conflictedPaths).toEqual(["a.ts", "b.ts"]);
      expect(parsed.payload.conflictOperation).toBe("merge");
    }
  });

  test("parses without the conflict fields (older daemon)", () => {
    const parsed = CheckoutStatusResponseSchema.parse(gitStatusPayload({}));
    expect(parsed.payload.isGit).toBe(true);
    if (parsed.payload.isGit) {
      expect(parsed.payload.conflictedPaths).toBeUndefined();
      expect(parsed.payload.conflictOperation).toBeUndefined();
    }
  });

  test("rejects an unknown conflict operation", () => {
    expect(() =>
      CheckoutStatusResponseSchema.parse(gitStatusPayload({ conflictOperation: "bisect" })),
    ).toThrow();
  });
});

describe("checkout abort/continue RPC schemas", () => {
  test("abort request + response round-trip through the session unions", () => {
    const request = { type: "checkout.abort_merge.request", cwd: "/tmp/repo", requestId: "r1" };
    expect(CheckoutAbortMergeRequestSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const response = {
      type: "checkout.abort_merge.response",
      payload: { cwd: "/tmp/repo", success: true, error: null, requestId: "r1" },
    };
    expect(CheckoutAbortMergeResponseSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("continue request + response round-trip through the session unions", () => {
    const request = { type: "checkout.continue_merge.request", cwd: "/tmp/repo", requestId: "r2" };
    expect(CheckoutContinueMergeRequestSchema.parse(request)).toEqual(request);
    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);

    const response = {
      type: "checkout.continue_merge.response",
      payload: { cwd: "/tmp/repo", success: false, error: null, requestId: "r2" },
    };
    expect(CheckoutContinueMergeResponseSchema.parse(response)).toEqual(response);
    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });
});
