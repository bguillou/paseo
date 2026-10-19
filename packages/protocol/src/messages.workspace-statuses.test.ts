import { describe, expect, test } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
  WorkspaceDescriptorPayloadSchema,
} from "./messages.js";

const legacyDescriptor = {
  id: "ws-1",
  projectId: "proj-1",
  projectDisplayName: "repo",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo",
  projectKind: "git",
  workspaceKind: "worktree",
  name: "feature",
  status: "done",
  activityAt: null,
  scripts: [],
};

describe("workspace status wire schemas", () => {
  test("keeps the capability and the descriptor field optional for old daemons", () => {
    expect(
      ServerInfoStatusPayloadSchema.parse({ status: "server_info", serverId: "old", features: {} })
        .features.workspaceStatuses,
    ).toBeUndefined();
    expect(WorkspaceDescriptorPayloadSchema.parse(legacyDescriptor).manualStatus).toBeUndefined();
  });

  test("carries a manual status on the descriptor and rejects an unknown baseline", () => {
    const manualStatus = { statusId: "sts_1", baseline: "in_review" };
    expect(
      WorkspaceDescriptorPayloadSchema.parse({ ...legacyDescriptor, manualStatus }).manualStatus,
    ).toEqual(manualStatus);
    expect(
      WorkspaceDescriptorPayloadSchema.safeParse({
        ...legacyDescriptor,
        manualStatus: { statusId: "sts_1", baseline: "needs_input" },
      }).success,
    ).toBe(false);
  });

  test("clears an assignment with a null manual status", () => {
    expect(
      SessionInboundMessageSchema.parse({
        type: "workspace.status.assignment.set.request",
        requestId: "req-1",
        workspaceId: "ws-1",
        manualStatus: null,
      }),
    ).toMatchObject({ manualStatus: null });
  });

  test("pushes the full catalog on change", () => {
    expect(
      SessionOutboundMessageSchema.parse({
        type: "workspace.status.catalog.changed",
        payload: {
          subscriptionId: "sub-1",
          statuses: [{ id: "sts_1", name: "Blocked", color: "red" }],
        },
      }),
    ).toMatchObject({ payload: { statuses: [{ id: "sts_1" }] } });
  });
});
