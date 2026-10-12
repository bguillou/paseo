import { parseHostPort } from "@getpaseo/protocol/daemon-endpoints";
import type { WorkspaceScriptPayload } from "@getpaseo/protocol/messages";
import type { ActiveConnection } from "@/runtime/host-runtime";

export type WorkspaceScriptLinkKind = "public" | "paseo" | "direct";

export interface WorkspaceScriptLinkTarget {
  kind: WorkspaceScriptLinkKind;
  label: string;
  url: string;
}

export interface ResolvedWorkspaceScriptLink {
  primary: WorkspaceScriptLinkTarget | null;
  targets: WorkspaceScriptLinkTarget[];
}

function isLoopbackHost(host: string): boolean {
  const normalizedHost = host.trim().toLowerCase();
  return (
    normalizedHost === "localhost" || normalizedHost === "127.0.0.1" || normalizedHost === "::1"
  );
}

function isLocalOnlyUrl(url: string | null | undefined): boolean {
  if (!url) return true;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return isLoopbackHost(hostname) || hostname.endsWith(".localhost");
  } catch {
    return true;
  }
}

function stripUrlProtocol(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

function previewUrlNeedsPort(template: string): boolean {
  return /\$\{?paseo_port\}?/i.test(template);
}

function previewUrlNeedsWorktreePort(template: string): boolean {
  return /\$\{?paseo_worktree_port\}?/i.test(template);
}

// Substitutes the `$PASEO_PORT` placeholder (case-insensitive, optional braces)
// with the assigned service port. The `paseo_port` pattern cannot match inside
// `$PASEO_WORKTREE_PORT`, so the two placeholders stay independent.
function substitutePaseoPort(template: string, port: number): string {
  return template.replace(/\$\{?paseo_port\}?/gi, String(port));
}

// Substitutes the `$PASEO_WORKTREE_PORT` placeholder with the deterministic
// per-worktree base port.
function substitutePaseoWorktreePort(template: string, port: number): string {
  return template.replace(/\$\{?paseo_worktree_port\}?/gi, String(port));
}

function buildDirectServiceUrl(
  activeConnection: ActiveConnection | null,
  port: number | null,
): string | null {
  if (port === null) return null;
  if (activeConnection?.type !== "directTcp") {
    return `http://localhost:${port}`;
  }
  try {
    const { host, isIpv6 } = parseHostPort(activeConnection.endpoint);
    let base = host;
    if (isLoopbackHost(host)) {
      base = "localhost";
    } else if (isIpv6) {
      base = `[${host}]`;
    }
    return `http://${base}:${port}`;
  } catch {
    return `http://localhost:${port}`;
  }
}

function addTarget(
  targets: WorkspaceScriptLinkTarget[],
  kind: WorkspaceScriptLinkKind,
  url: string | null | undefined,
): void {
  if (!url || targets.some((target) => target.url === url)) return;
  targets.push({ kind, label: stripUrlProtocol(url), url });
}

export function resolveWorkspaceScriptLink(input: {
  script: WorkspaceScriptPayload;
  activeConnection: ActiveConnection | null;
}): ResolvedWorkspaceScriptLink {
  const { script, activeConnection } = input;
  if (script.type !== "service" || script.lifecycle !== "running") {
    return { primary: null, targets: [] };
  }

  // A config-set previewUrl overrides the generated proxy routes entirely. It may
  // reference the assigned service port via `$PASEO_PORT` or the deterministic
  // per-worktree base port via `$PASEO_WORKTREE_PORT`; if a referenced port isn't
  // known yet we can't resolve the override, so no preview link is offered.
  const previewUrl = script.previewUrl?.trim();
  if (previewUrl) {
    const worktreePort = script.worktreePort ?? null;
    const missingPort = previewUrlNeedsPort(previewUrl) && script.port === null;
    const missingWorktreePort = previewUrlNeedsWorktreePort(previewUrl) && worktreePort === null;
    if (missingPort || missingWorktreePort) {
      return { primary: null, targets: [] };
    }
    let resolvedUrl = previewUrl;
    if (worktreePort !== null) {
      resolvedUrl = substitutePaseoWorktreePort(resolvedUrl, worktreePort);
    }
    if (script.port !== null) {
      resolvedUrl = substitutePaseoPort(resolvedUrl, script.port);
    }
    const overrideTarget: WorkspaceScriptLinkTarget = {
      kind: "direct",
      label: stripUrlProtocol(resolvedUrl),
      url: resolvedUrl,
    };
    return { primary: overrideTarget, targets: [overrideTarget] };
  }

  // COMPAT(workspaceScriptSplitUrls): added in v0.2.0, remove after 2027-01-21.
  // Old daemons only send proxyUrl, so classify it by reachability.
  const localProxyUrl =
    script.localProxyUrl ?? (isLocalOnlyUrl(script.proxyUrl) ? script.proxyUrl : null);
  const publicProxyUrl =
    script.publicProxyUrl ?? (!isLocalOnlyUrl(script.proxyUrl) ? script.proxyUrl : null);

  const targets: WorkspaceScriptLinkTarget[] = [];
  addTarget(targets, "public", publicProxyUrl);
  addTarget(targets, "paseo", localProxyUrl);
  addTarget(targets, "direct", buildDirectServiceUrl(activeConnection, script.port));

  return { primary: targets[0] ?? null, targets };
}
