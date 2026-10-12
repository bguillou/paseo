import type { AgentPlanEntry } from "@getpaseo/client/internal/daemon-client";
import type { PlanContextAttachment } from "@/attachments/types";

/**
 * Wraps a daemon plan-list entry into a `plan_context` composer attachment. The
 * daemon already formatted the plan as a text attachment (wrapped in a `<plan>`
 * block), so this only carries identity and dedup state.
 *
 * `id` controls dedup in the workspace-attachments store: keying by source agent
 * and plan lets several plans coexist and re-picking one replace it.
 */
export function buildPlanContextAttachment(input: {
  serverId: string;
  entry: AgentPlanEntry;
}): PlanContextAttachment {
  const { serverId, entry } = input;
  return {
    kind: "plan_context",
    id: `plan_context:${entry.agentId}:${entry.planKey}`,
    attachment: entry.attachment,
    source: {
      serverId,
      agentId: entry.agentId,
      planKey: entry.planKey,
      createdAt: entry.createdAt,
      outcome: entry.outcome,
    },
  };
}
