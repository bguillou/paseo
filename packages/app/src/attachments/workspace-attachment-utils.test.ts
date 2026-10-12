import { describe, expect, it } from "vitest";
import type {
  ComposerAttachment,
  PlanContextAttachment,
  PullRequestContextAttachment,
} from "./types";
import {
  isWorkspaceAttachment,
  userAttachmentsOnly,
  workspaceAttachmentToSubmitAttachment,
} from "./workspace-attachment-utils";

function planAttachment(overrides: Partial<PlanContextAttachment> = {}): PlanContextAttachment {
  return {
    kind: "plan_context",
    id: "plan_context:agent-1:call-1",
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "plan",
      title: "Plan",
      text: "<plan>Do the thing</plan>",
    },
    source: {
      serverId: "local",
      agentId: "agent-1",
      planKey: "call-1",
      createdAt: 1700000000000,
      outcome: "approved",
    },
    ...overrides,
  };
}

function contextAttachment(
  overrides: Partial<PullRequestContextAttachment> = {},
): PullRequestContextAttachment {
  return {
    kind: "github.pull_request_comment",
    id: "comment-1",
    title: "Comment · octocat",
    subtitle: "Fix flaky build",
    text: "GitHub pull request comment\n\nLooks good.",
    url: "https://github.com/getpaseo/paseo/pull/42#issuecomment-1",
    ...overrides,
  };
}

describe("workspace attachment utilities", () => {
  it("treats pull request context as a workspace attachment", () => {
    expect(isWorkspaceAttachment(contextAttachment())).toBe(true);
  });

  it("strips context attachments from user draft attachments", () => {
    const normalAttachment: ComposerAttachment = {
      kind: "github_issue",
      item: {
        kind: "issue",
        number: 12,
        title: "Bug",
        url: "https://github.com/getpaseo/paseo/issues/12",
        state: "open",
        body: "Bug report",
        labels: [],
        baseRefName: null,
        headRefName: null,
      },
    };

    expect(userAttachmentsOnly([normalAttachment, contextAttachment()])).toEqual([
      normalAttachment,
    ]);
  });

  it("serializes context attachments as protocol text attachments", () => {
    expect(workspaceAttachmentToSubmitAttachment(contextAttachment())).toEqual({
      type: "text",
      mimeType: "text/plain",
      title: "Comment · octocat",
      text: "GitHub pull request comment\n\nLooks good.",
    });
  });

  it("treats a plan context as a workspace attachment and strips it from user drafts", () => {
    const plan = planAttachment();
    expect(isWorkspaceAttachment(plan)).toBe(true);
    expect(userAttachmentsOnly([plan])).toEqual([]);
  });

  it("submits a plan context as its prebuilt text attachment", () => {
    const plan = planAttachment();
    expect(workspaceAttachmentToSubmitAttachment(plan)).toEqual(plan.attachment);
  });
});
