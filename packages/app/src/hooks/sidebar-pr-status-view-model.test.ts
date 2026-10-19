import { describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18next";
import type { PrHint } from "@/git/pr-hint";
import type { SidebarWorkspaceEntry } from "./sidebar-workspaces-view-model";
import {
  buildPrStatusGroups,
  derivePrStatusBucket,
  getPrStatusBucketLabel,
  PR_STATUS_BUCKET_ORDER,
  resolveEffectivePrStatus,
  type PrStatusGroup,
} from "./sidebar-pr-status-view-model";

function prHint(input: Partial<PrHint> & { state: PrHint["state"] }): PrHint {
  return {
    url: input.url ?? "https://github.com/acme/repo/pull/7",
    number: input.number ?? 7,
    state: input.state,
    forge: input.forge ?? "github",
    checks: input.checks,
    checksStatus: input.checksStatus,
    reviewDecision: input.reviewDecision,
  };
}

function ws(
  input: Partial<SidebarWorkspaceEntry> & { workspaceKey: string },
): SidebarWorkspaceEntry {
  return {
    serverId: input.serverId ?? "srv",
    workspaceId: input.workspaceId ?? input.workspaceKey.split(":")[1] ?? "ws",
    projectViewKey: input.projectViewKey ?? "proj",
    projectName: input.projectName ?? "Project",
    projectRootPath: input.projectRootPath,
    workspaceDirectory: input.workspaceDirectory ?? "",
    workspaceDirectoryLabel: input.workspaceDirectoryLabel ?? "",
    projectKind: input.projectKind ?? "git",
    workspaceKind: input.workspaceKind ?? "worktree",
    name: input.name ?? "main",
    title: input.title ?? null,
    currentBranch: input.currentBranch ?? null,
    baseRef: null,
    statusBucket: input.statusBucket ?? "done",
    statusEnteredAt: input.statusEnteredAt ?? null,
    archivingAt: null,
    diffStat: null,
    prHint: input.prHint ?? null,
    archiveHasUncommittedChanges: null,
    archiveUnpushedCommitCount: null,
    scripts: [],
    hasRunningScripts: false,
    hasUserMessage: input.hasUserMessage ?? false,
    manualStatus: input.manualStatus ?? null,
    workspaceKey: input.workspaceKey,
  };
}

const emptyProjectNames = new Map<string, string>();

describe("derivePrStatusBucket", () => {
  it("buckets a merged PR as done", () => {
    expect(
      derivePrStatusBucket(ws({ workspaceKey: "srv:a", prHint: prHint({ state: "merged" }) })),
    ).toBe("done");
  });

  it("buckets any open PR as in_review, whatever the review decision", () => {
    for (const reviewDecision of ["changes_requested", "pending", "approved", null] as const) {
      expect(
        derivePrStatusBucket(
          ws({ workspaceKey: "srv:a", prHint: prHint({ state: "open", reviewDecision }) }),
        ),
      ).toBe("in_review");
    }
  });

  it("buckets a workspace with no PR by whether a message was sent", () => {
    expect(
      derivePrStatusBucket(ws({ workspaceKey: "srv:a", prHint: null, hasUserMessage: true })),
    ).toBe("in_progress");
    expect(
      derivePrStatusBucket(ws({ workspaceKey: "srv:a", prHint: null, hasUserMessage: false })),
    ).toBe("backlog");
  });

  it("treats a closed-but-not-merged PR like no PR, falling back to message state", () => {
    expect(
      derivePrStatusBucket(
        ws({ workspaceKey: "srv:a", prHint: prHint({ state: "closed" }), hasUserMessage: true }),
      ),
    ).toBe("in_progress");
    expect(
      derivePrStatusBucket(
        ws({ workspaceKey: "srv:a", prHint: prHint({ state: "closed" }), hasUserMessage: false }),
      ),
    ).toBe("backlog");
  });
});

describe("buildPrStatusGroups", () => {
  it("groups workspaces by PR-status bucket in fixed order", () => {
    const workspaces = [
      ws({ workspaceKey: "srv:backlog", name: "backlog", hasUserMessage: false }),
      ws({ workspaceKey: "srv:done", name: "done", prHint: prHint({ state: "merged" }) }),
      ws({ workspaceKey: "srv:progress", name: "progress", hasUserMessage: true }),
      ws({ workspaceKey: "srv:review", name: "review", prHint: prHint({ state: "open" }) }),
    ];

    const groups = buildPrStatusGroups(workspaces, emptyProjectNames, {}, i18n.t);

    expect(groups.map((g) => g.id)).toEqual(["in_review", "in_progress", "backlog", "done"]);
    expect(groups.map((g) => g.label)).toEqual(["In review", "In progress", "Backlog", "Done"]);
  });

  it("omits empty buckets", () => {
    const workspaces = [
      ws({ workspaceKey: "srv:a", prHint: prHint({ state: "merged" }) }),
      ws({ workspaceKey: "srv:b", prHint: prHint({ state: "open" }) }),
    ];

    const groups = buildPrStatusGroups(workspaces, emptyProjectNames, {}, i18n.t);

    expect(groups.map((g) => g.id)).toEqual(["in_review", "done"]);
  });

  it("sorts by statusEnteredAt desc within a bucket", () => {
    const workspaces = [
      ws({
        workspaceKey: "srv:old",
        hasUserMessage: true,
        statusEnteredAt: new Date("2026-01-01T00:00:00Z"),
      }),
      ws({
        workspaceKey: "srv:new",
        hasUserMessage: true,
        statusEnteredAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ];

    const groups = buildPrStatusGroups(workspaces, emptyProjectNames, {}, i18n.t);

    expect(groups[0]?.id).toBe("in_progress");
    expect(groups[0]?.rows.map((r) => r.workspaceKey)).toEqual(["srv:new", "srv:old"]);
  });

  it("returns empty array for no workspaces", () => {
    expect(buildPrStatusGroups([], emptyProjectNames, {}, i18n.t)).toEqual([]);
  });
});

const blocked = { id: "sts_blocked", name: "Blocked", color: "red" } as const;
const catalogs = { srv: [blocked] };

function describeGroup(group: PrStatusGroup): [string, string, string[]] {
  return [group.id, group.label, group.rows.map((row) => row.workspaceKey)];
}
describe("resolveEffectivePrStatus", () => {
  it("shows the manual status while the derived bucket equals its baseline", () => {
    const entry = ws({
      workspaceKey: "srv:a",
      hasUserMessage: true,
      manualStatus: { statusId: blocked.id, baseline: "in_progress" },
    });
    expect(resolveEffectivePrStatus(entry, catalogs)).toEqual({ kind: "custom", status: blocked });
  });

  it("drops the manual status once the derived bucket moves away from the baseline", () => {
    const entry = ws({
      workspaceKey: "srv:a",
      prHint: prHint({ state: "open" }),
      manualStatus: { statusId: blocked.id, baseline: "in_progress" },
    });
    expect(resolveEffectivePrStatus(entry, catalogs)).toEqual({
      kind: "auto",
      bucket: "in_review",
    });
  });

  it("accepts an auto status as the manual status", () => {
    const entry = ws({
      workspaceKey: "srv:a",
      manualStatus: { statusId: "done", baseline: "backlog" },
    });
    expect(resolveEffectivePrStatus(entry, catalogs)).toEqual({ kind: "auto", bucket: "done" });
  });

  it("falls back to the derived bucket for a status its own host does not know", () => {
    const manualStatus = { statusId: blocked.id, baseline: "backlog" } as const;
    expect(resolveEffectivePrStatus(ws({ workspaceKey: "srv:a", manualStatus }), {})).toEqual({
      kind: "auto",
      bucket: "backlog",
    });
    expect(
      resolveEffectivePrStatus(
        ws({ workspaceKey: "other:a", serverId: "other", manualStatus }),
        catalogs,
      ),
    ).toEqual({ kind: "auto", bucket: "backlog" });
  });
});

describe("buildPrStatusGroups with custom statuses", () => {
  it("puts custom groups after the auto buckets and merges same-named statuses across hosts", () => {
    const qa = { id: "sts_qa", name: "QA", color: "sky" } as const;
    const otherBlocked = { id: "sts_other", name: "blocked", color: "amber" } as const;
    const workspaces = [
      ws({
        workspaceKey: "srv:a",
        manualStatus: { statusId: blocked.id, baseline: "backlog" },
      }),
      ws({
        workspaceKey: "other:b",
        serverId: "other",
        manualStatus: { statusId: otherBlocked.id, baseline: "backlog" },
      }),
      ws({ workspaceKey: "srv:c", manualStatus: { statusId: qa.id, baseline: "backlog" } }),
      ws({ workspaceKey: "srv:d" }),
    ];

    const groups = buildPrStatusGroups(
      workspaces,
      emptyProjectNames,
      { srv: [qa, blocked], other: [otherBlocked] },
      i18n.t,
    );

    expect(groups.map(describeGroup)).toEqual([
      ["backlog", "Backlog", ["srv:d"]],
      ["custom:blocked", "blocked", ["other:b", "srv:a"]],
      ["custom:qa", "QA", ["srv:c"]],
    ]);
    expect(groups[1]?.leading).toEqual({ kind: "custom", color: "amber" });
  });
});

describe("getPrStatusBucketLabel", () => {
  it("reads in the active app language", async () => {
    await i18n.changeLanguage("fr");
    try {
      expect(
        PR_STATUS_BUCKET_ORDER.map((bucket) => getPrStatusBucketLabel(bucket, i18n.t)),
      ).toEqual(["En revue", "En cours", "À faire", "Terminé"]);
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
