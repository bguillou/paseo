import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { selectChatHistoryCandidateAgents } from "./chat-history-candidates";

function agent(input: { id: string; cwd: string; serverId?: string }): AggregatedAgent {
  return {
    id: input.id,
    cwd: input.cwd,
    serverId: input.serverId ?? "server-1",
  } as unknown as AggregatedAgent;
}

describe("selectChatHistoryCandidateAgents", () => {
  it("keeps agents in the same project on the same host", () => {
    const agents = [agent({ id: "a", cwd: "/repo" }), agent({ id: "b", cwd: "/repo" })];
    const result = selectChatHistoryCandidateAgents({ agents, serverId: "server-1", cwd: "/repo" });
    expect(result.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("excludes agents from other projects", () => {
    const agents = [agent({ id: "a", cwd: "/repo" }), agent({ id: "other", cwd: "/elsewhere" })];
    const result = selectChatHistoryCandidateAgents({ agents, serverId: "server-1", cwd: "/repo" });
    expect(result.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("excludes agents from other hosts", () => {
    const agents = [agent({ id: "a", cwd: "/repo", serverId: "server-2" })];
    const result = selectChatHistoryCandidateAgents({ agents, serverId: "server-1", cwd: "/repo" });
    expect(result).toHaveLength(0);
  });

  it("collapses worktrees to the parent repo so siblings match", () => {
    const agents = [agent({ id: "worktree", cwd: "/repo/.paseo/worktrees/abc/feature" })];
    const result = selectChatHistoryCandidateAgents({ agents, serverId: "server-1", cwd: "/repo" });
    expect(result.map((entry) => entry.id)).toEqual(["worktree"]);
  });

  it("excludes the draft's own agent id", () => {
    const agents = [agent({ id: "self", cwd: "/repo" }), agent({ id: "b", cwd: "/repo" })];
    const result = selectChatHistoryCandidateAgents({
      agents,
      serverId: "server-1",
      cwd: "/repo",
      excludeAgentId: "self",
    });
    expect(result.map((entry) => entry.id)).toEqual(["b"]);
  });
});
