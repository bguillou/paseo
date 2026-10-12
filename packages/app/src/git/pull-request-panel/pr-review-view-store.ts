import { useCallback } from "react";
import { create } from "zustand";

/**
 * Whether resolved PR review threads are revealed. Resolved threads are hidden by
 * default in both surfaces that render them — the PR panel list and the inline
 * diff overlay — which live in separate panels. This shared store keys the
 * preference by server+cwd so the one "Show resolved" toggle keeps both in sync.
 */
interface PrReviewViewStoreState {
  showResolvedByKey: Record<string, boolean>;
}

interface PrReviewViewStoreActions {
  setShowResolved: (input: { key: string; showResolved: boolean }) => void;
}

type PrReviewViewStore = PrReviewViewStoreState & PrReviewViewStoreActions;

const usePrReviewViewStore = create<PrReviewViewStore>((set) => ({
  showResolvedByKey: {},
  setShowResolved: ({ key, showResolved }) =>
    set((state) => ({
      showResolvedByKey: { ...state.showResolvedByKey, [key]: showResolved },
    })),
}));

function buildKey(serverId: string, cwd: string): string {
  return `${serverId}\u0000${cwd}`;
}

/** Reads the current "show resolved" flag for a workspace's PR review. */
export function usePrShowResolved(serverId: string, cwd: string): boolean {
  return usePrReviewViewStore((state) => state.showResolvedByKey[buildKey(serverId, cwd)] ?? false);
}

/** Returns the flag plus a toggle, for the control that owns the preference. */
export function usePrShowResolvedToggle(
  serverId: string,
  cwd: string,
): { showResolved: boolean; toggleShowResolved: () => void } {
  const key = buildKey(serverId, cwd);
  const showResolved = usePrReviewViewStore((state) => state.showResolvedByKey[key] ?? false);
  const setShowResolved = usePrReviewViewStore((state) => state.setShowResolved);
  const toggleShowResolved = useCallback(
    () => setShowResolved({ key, showResolved: !showResolved }),
    [key, setShowResolved, showResolved],
  );
  return { showResolved, toggleShowResolved };
}
