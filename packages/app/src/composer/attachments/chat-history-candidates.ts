import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { deriveProjectKey } from "@/utils/agent-grouping";

/**
 * Selects the conversations a new-agent draft can attach as chat history:
 * other agents on the same host and in the same project. Project membership is
 * compared with `deriveProjectKey` on both sides (collapsing worktrees to their
 * parent repo), which stays consistent at draft time when the draft only knows
 * its working directory and has no resolved `projectPlacement` yet.
 */
export function selectChatHistoryCandidateAgents(input: {
  agents: readonly AggregatedAgent[];
  serverId: string;
  cwd: string;
  excludeAgentId?: string;
}): AggregatedAgent[] {
  const projectKey = deriveProjectKey(input.cwd);
  return input.agents.filter(
    (agent) =>
      agent.serverId === input.serverId &&
      agent.id !== input.excludeAgentId &&
      deriveProjectKey(agent.cwd) === projectKey,
  );
}
