import { useMemo } from "react";
import { ForgeSearchItemSchema, type ForgeSearchItem } from "@getpaseo/protocol/messages";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useFetchQuery } from "@/data/query";
import type { Forge } from "@/git/forge";
import { i18n } from "@/i18n/i18next";
import { buildPrStack, type PrStackCurrent, type PrStackEntry } from "./pr-stack";

const PR_STACK_STALE_TIME = 30_000;
// A stack this deep is already pathological; the cap bounds the number of searches.
const MAX_STACK_DEPTH = 20;
const PER_LEVEL_LIMIT = 20;

export interface UsePrStackOptions {
  serverId: string;
  cwd: string;
  /** The current workspace's PR, or null when there is none to anchor a stack. */
  current: PrStackCurrent | null;
  /** The forge hosting the PR. Stack discovery uses GitHub search syntax. */
  forge: Forge;
  enabled: boolean;
}

export interface UsePrStackResult {
  stack: PrStackEntry[];
  isLoading: boolean;
}

type ForgeSearchClient = Pick<DaemonClient, "searchForge">;

/**
 * Assembles the stack the current PR belongs to by walking branch-filtered forge searches:
 * `head:<base>` upward to collect ancestors, `base:<head>` downward (breadth-first) to collect
 * descendants. This stays correct on busy repos where a blanket "list open PRs" would miss the
 * chain beyond its page limit. The `head:`/`base:` qualifiers are GitHub search syntax, so this
 * is gated to GitHub; other forges need a branch-filtered RPC (not yet exposed). Reuses the
 * existing `forge.search` RPC, so no protocol or daemon change is required.
 */
export function usePrStack({
  serverId,
  cwd,
  current,
  forge,
  enabled,
}: UsePrStackOptions): UsePrStackResult {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const queryEnabled =
    enabled && forge === "github" && !!client && isConnected && !!cwd && !!current;

  const query = useFetchQuery({
    queryKey: [
      "pr-stack",
      serverId,
      cwd,
      current?.number ?? null,
      current?.headRefName ?? null,
      current?.baseRefName ?? null,
    ] as const,
    queryFn: async () => {
      if (!client || !current) {
        throw new Error(i18n.t("common.errors.daemonClientUnavailable"));
      }
      return collectStackChangeRequests({ client, cwd, current });
    },
    enabled: queryEnabled,
    dataShape: "list",
    staleTimeMs: PR_STACK_STALE_TIME,
  });

  const stack = useMemo(() => {
    if (!current) {
      return [];
    }
    return buildPrStack({ current, openChangeRequests: query.data ?? [] });
  }, [current, query.data]);

  return { stack, isLoading: query.isLoading };
}

async function collectStackChangeRequests({
  client,
  cwd,
  current,
}: {
  client: ForgeSearchClient;
  cwd: string;
  current: PrStackCurrent;
}): Promise<ForgeSearchItem[]> {
  const collected = new Map<number, ForgeSearchItem>();
  const searchedQueries = new Set<string>();

  // Ancestors: the parent is the PR whose head is this PR's base. Follow base refs upward.
  let base = current.baseRefName.trim();
  for (let depth = 0; depth < MAX_STACK_DEPTH && base; depth++) {
    const matches = await searchByQuery({ client, cwd, searchedQueries, query: `head:${base}` });
    const parent = matches.find((pr) => pr.headRefName === base && pr.number !== current.number);
    if (!parent || collected.has(parent.number)) {
      break;
    }
    collected.set(parent.number, parent);
    base = (parent.baseRefName ?? "").trim();
  }

  // Descendants: children are PRs whose base is a head already in the chain. Walk breadth-first.
  const queue: string[] = [current.headRefName.trim()];
  for (let steps = 0; steps < MAX_STACK_DEPTH && queue.length > 0; steps++) {
    const head = queue.shift();
    if (!head) {
      continue;
    }
    const children = await searchByQuery({ client, cwd, searchedQueries, query: `base:${head}` });
    for (const child of children) {
      if (
        child.baseRefName === head &&
        child.number !== current.number &&
        !collected.has(child.number)
      ) {
        collected.set(child.number, child);
        const childHead = (child.headRefName ?? "").trim();
        if (childHead) {
          queue.push(childHead);
        }
      }
    }
  }

  return [...collected.values()];
}

async function searchByQuery({
  client,
  cwd,
  searchedQueries,
  query,
}: {
  client: ForgeSearchClient;
  cwd: string;
  searchedQueries: Set<string>;
  query: string;
}): Promise<ForgeSearchItem[]> {
  if (searchedQueries.has(query)) {
    return [];
  }
  searchedQueries.add(query);
  const payload = await client.searchForge({
    cwd,
    query,
    limit: PER_LEVEL_LIMIT,
    kinds: ["change_request"],
  });
  return payload.items.flatMap((item) => {
    const parsed = ForgeSearchItemSchema.safeParse(item);
    return parsed.success && parsed.data.kind === "change_request" ? [parsed.data] : [];
  });
}
