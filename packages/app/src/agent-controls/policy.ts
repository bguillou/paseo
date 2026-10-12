import type { AgentMode } from "@getpaseo/protocol/agent-types";

export const PLAN_MODE_FEATURE_ID = "plan_mode";
export const FAST_MODE_FEATURE_ID = "fast_mode";
export const SPEED_FEATURE_ID = "service_tier";

export function isPlanningAgentMode(mode: Pick<AgentMode, "id" | "colorTier">): boolean {
  return mode.colorTier === "planning" || mode.id === "plan" || mode.id.endsWith("#plan");
}

export function resolveNonPlanningModeId(
  modes: readonly AgentMode[],
  defaultModeId: string | null,
): string | null {
  const defaultMode = modes.find((mode) => mode.id === defaultModeId);
  if (defaultMode && !isPlanningAgentMode(defaultMode)) {
    return defaultMode.id;
  }
  return modes.find((mode) => !isPlanningAgentMode(mode))?.id ?? null;
}

/**
 * Whether the currently-selected mode is a planning mode. Resolves the selected mode the same
 * way the mode control does — the chosen id, falling back to the first available mode.
 */
export function isPlanModeSelected(
  modes: readonly AgentMode[],
  selectedModeId: string | null | undefined,
): boolean {
  if (modes.length === 0) return false;
  const selected = modes.find((mode) => mode.id === selectedModeId) ?? modes[0];
  return isPlanningAgentMode(selected);
}
