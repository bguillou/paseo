import { useShallow } from "zustand/shallow";
import { isPlanModeSelected, isPlanningAgentMode } from "@/agent-controls/policy";
import type { DraftAgentControlsProps } from "@/composer/agent-controls";
import { useSessionStore } from "@/stores/session-store";

/**
 * Whether the composer's active agent mode is a planning mode. Drives the plan-mode hatch on the
 * input box. Reads the live mode straight from the session store (no provider-snapshot fetch, unlike
 * `useLiveAgentModeControl`), and falls back to the draft controls' selection for draft composers.
 */
export function useComposerPlanModeActive({
  serverId,
  agentId,
  draftControls,
}: {
  serverId: string;
  agentId: string;
  draftControls: DraftAgentControlsProps | undefined;
}): boolean {
  const liveSelectedMode = useSessionStore(
    useShallow((state) => {
      const agent = state.sessions[serverId]?.agents?.get(agentId);
      const modes = agent?.availableModes;
      if (!modes || modes.length === 0) return null;
      const selected = modes.find((mode) => mode.id === agent.currentModeId) ?? modes[0];
      return { id: selected.id, colorTier: selected.colorTier };
    }),
  );

  if (draftControls) {
    return isPlanModeSelected(draftControls.modeOptions, draftControls.selectedMode);
  }
  return liveSelectedMode ? isPlanningAgentMode(liveSelectedMode) : false;
}
