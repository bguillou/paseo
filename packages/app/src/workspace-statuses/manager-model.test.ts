import { describe, expect, it } from "vitest";
import {
  WorkspaceStatusManagerModel,
  workspaceStatusErrorMessage,
  type WorkspaceStatusManagerHost,
} from "./manager-model";

const blocked = { id: "sts_blocked", name: "Blocked", color: "red" } as const;

function host(input: Partial<WorkspaceStatusManagerHost> & { serverId: string }) {
  return {
    label: input.serverId,
    status: "online" as const,
    statuses: [],
    error: null,
    ...input,
  };
}

function rpcError(code: string): Error {
  return Object.assign(new Error(`Server says no code=${code}`), { code });
}

function createModel() {
  const calls: unknown[] = [];
  let failWith: Error | null = null;
  const record = async (call: unknown) => {
    calls.push(call);
    if (failWith) throw failWith;
  };
  const model = new WorkspaceStatusManagerModel({
    create: (input) => record({ create: input }),
    update: (input) => record({ update: input }),
    delete: (input) => record({ delete: input }),
  });
  return {
    model,
    calls,
    fail: (error: Error | null) => {
      failWith = error;
    },
  };
}

describe("WorkspaceStatusManagerModel", () => {
  it("selects the first online host and keeps the selection while it still exists", () => {
    const { model } = createModel();
    model.syncHosts([host({ serverId: "a", status: "offline" }), host({ serverId: "b" })]);
    expect(model.snapshot().serverId).toBe("b");

    model.selectHost("a");
    model.syncHosts([host({ serverId: "a" }), host({ serverId: "b" })]);
    expect(model.snapshot().serverId).toBe("a");
  });

  it("creates a status with a normalized name and closes the draft", async () => {
    const { model, calls } = createModel();
    model.syncHosts([host({ serverId: "a" })]);
    model.startCreate();
    expect(model.snapshot().canSave).toBe(false);

    model.setDraftName("  Waiting   on QA ");
    model.setDraftColor("sky");
    await model.save();

    expect(calls).toEqual([{ create: { serverId: "a", name: "Waiting on QA", color: "sky" } }]);
    expect(model.snapshot().draft).toBeNull();
  });

  it("sends only the fields an edit changed, and nothing for an unchanged draft", async () => {
    const { model, calls } = createModel();
    model.syncHosts([host({ serverId: "a", statuses: [blocked] })]);
    model.edit(blocked);
    expect(model.snapshot().canSave).toBe(false);
    await model.save();

    model.setDraftColor("amber");
    await model.save();

    expect(calls).toEqual([{ update: { serverId: "a", id: blocked.id, color: "amber" } }]);
  });

  it("keeps the draft and explains a name collision", async () => {
    const { model, fail } = createModel();
    model.syncHosts([host({ serverId: "a" })]);
    model.startCreate();
    model.setDraftName("Blocked");
    fail(rpcError("status_name_taken"));

    await model.save();

    expect(model.snapshot()).toMatchObject({
      draft: { mode: "create", name: "Blocked" },
      error: "A status with that name already exists",
      pending: false,
    });
  });

  it("deletes the edited status only after confirmation", async () => {
    const { model, calls } = createModel();
    model.syncHosts([host({ serverId: "a", statuses: [blocked] })]);
    model.edit(blocked);

    await model.delete(async () => false);
    expect(calls).toEqual([]);

    await model.delete(async () => true);
    expect(calls).toEqual([{ delete: { serverId: "a", id: blocked.id } }]);
    expect(model.snapshot().draft).toBeNull();
  });

  it("cannot save while the selected host is offline", () => {
    const { model } = createModel();
    model.syncHosts([host({ serverId: "a", status: "offline" })]);
    model.startCreate();
    model.setDraftName("Blocked");
    expect(model.snapshot().canSave).toBe(false);
  });
});

describe("workspaceStatusErrorMessage", () => {
  it("maps known codes and falls back for anything else", () => {
    expect(workspaceStatusErrorMessage(rpcError("status_name_empty"))).toBe(
      "Status name cannot be empty",
    );
    expect(workspaceStatusErrorMessage(new Error("boom"))).toBe("Unable to update status");
    expect(workspaceStatusErrorMessage("nope")).toBe("Unable to update status");
  });
});
