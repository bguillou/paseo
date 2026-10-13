import type {
  PaseoConfigRaw,
  PaseoMetadataGeneration,
  PaseoMetadataGenerationEntry,
  PaseoScriptEntryRaw,
} from "@getpaseo/protocol/messages";

export type LifecycleOriginalKind = "string" | "array" | "missing";

export const METADATA_PROMPT_KEYS = ["branchName", "commitMessage", "pullRequest"] as const;
export type MetadataPromptKey = (typeof METADATA_PROMPT_KEYS)[number];

export interface ProjectScriptDraft {
  id: string;
  name: string;
  commandText: string;
  commandOriginalKind: LifecycleOriginalKind;
  type: string;
  portText: string;
  previewUrlText: string;
  rawEntry: PaseoScriptEntryRaw;
}

export interface ProjectConfigDraft {
  setupText: string;
  setupOriginalKind: LifecycleOriginalKind;
  teardownText: string;
  teardownOriginalKind: LifecycleOriginalKind;
  portBaseText: string;
  scripts: ProjectScriptDraft[];
  metadataPrompts: Record<MetadataPromptKey, string>;
  metadataGenerationBase: PaseoMetadataGeneration | undefined;
}

/**
 * Validates the "Port start" draft field. Empty is allowed (clears the
 * opt-in); otherwise it must be an integer TCP port in [1, 65535], matching
 * `PaseoWorktreeConfigRawSchema.portBase`.
 */
export function portBaseDraftError(text: string): "invalid" | "range" | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (!/^[0-9]+$/.test(trimmed)) {
    return "invalid";
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return "range";
  }
  return null;
}

interface LifecycleProjection {
  text: string;
  kind: LifecycleOriginalKind;
}

function projectLifecycle(value: unknown): LifecycleProjection {
  if (typeof value === "string") {
    return { text: value, kind: "string" };
  }
  if (Array.isArray(value)) {
    const lines = value.filter((entry): entry is string => typeof entry === "string");
    return { text: lines.join("\n"), kind: "array" };
  }
  return { text: "", kind: "missing" };
}

function lifecycleFromText(
  text: string,
  kind: LifecycleOriginalKind,
): string | string[] | undefined {
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return undefined;
  }
  if (kind === "string") {
    return lines.join("\n");
  }
  if (kind === "array") {
    return lines;
  }
  return lines.length === 1 ? lines[0] : lines;
}

function projectScriptType(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function projectScriptPort(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    return value;
  }
  return "";
}

function parseScriptPort(value: string): number | string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (/^[0-9]+$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return trimmed;
}

let scriptDraftIdCounter = 0;

function nextScriptDraftId(): string {
  scriptDraftIdCounter += 1;
  return `script-draft-${scriptDraftIdCounter}`;
}

function emptyMetadataPrompts(): Record<MetadataPromptKey, string> {
  return {
    branchName: "",
    commitMessage: "",
    pullRequest: "",
  };
}

export function configToDraft(config: PaseoConfigRaw | null | undefined): ProjectConfigDraft {
  const worktree = config?.worktree ?? {};
  const setup = projectLifecycle(worktree.setup);
  const teardown = projectLifecycle(worktree.teardown);
  const scripts: ProjectScriptDraft[] = [];

  const scriptsRecord = config?.scripts ?? {};
  for (const [name, entry] of Object.entries(scriptsRecord)) {
    const command = projectLifecycle(entry.command);
    scripts.push({
      id: nextScriptDraftId(),
      name,
      commandText: command.text,
      commandOriginalKind: command.kind,
      type: projectScriptType(entry.type),
      portText: projectScriptPort(entry.port),
      previewUrlText: typeof entry.previewUrl === "string" ? entry.previewUrl : "",
      rawEntry: entry,
    });
  }

  const metadataGeneration = config?.metadataGeneration;
  const metadataPrompts = emptyMetadataPrompts();
  for (const key of METADATA_PROMPT_KEYS) {
    const instructions = metadataGeneration?.[key]?.instructions;
    if (typeof instructions === "string") {
      metadataPrompts[key] = instructions;
    }
  }

  return {
    setupText: setup.text,
    setupOriginalKind: setup.kind,
    teardownText: teardown.text,
    teardownOriginalKind: teardown.kind,
    portBaseText: typeof worktree.portBase === "number" ? String(worktree.portBase) : "",
    scripts,
    metadataPrompts,
    metadataGenerationBase: metadataGeneration,
  };
}

// Keep the schema key `portBase`; the UI labels it "Port start". Drop it when
// empty or invalid (Save is disabled on invalid input, so this never persists
// a bad value).
function applyPortBaseToWorktree(worktree: Record<string, unknown>, portBaseText: string): void {
  const trimmed = portBaseText.trim();
  if (trimmed.length > 0 && portBaseDraftError(trimmed) === null) {
    worktree.portBase = Number(trimmed);
  } else {
    delete worktree.portBase;
  }
}

interface ApplyDraftInput {
  draft: ProjectConfigDraft;
  base: PaseoConfigRaw | null | undefined;
}

export function applyDraftToConfig(input: ApplyDraftInput): PaseoConfigRaw {
  const baseConfig = input.base ?? {};
  const baseWorktree = baseConfig.worktree ?? {};

  const nextWorktree: Record<string, unknown> = { ...baseWorktree };
  const nextSetup = lifecycleFromText(input.draft.setupText, input.draft.setupOriginalKind);
  if (nextSetup === undefined) {
    delete nextWorktree.setup;
  } else {
    nextWorktree.setup = nextSetup;
  }
  const nextTeardown = lifecycleFromText(
    input.draft.teardownText,
    input.draft.teardownOriginalKind,
  );
  if (nextTeardown === undefined) {
    delete nextWorktree.teardown;
  } else {
    nextWorktree.teardown = nextTeardown;
  }

  applyPortBaseToWorktree(nextWorktree, input.draft.portBaseText);

  const nextScripts: Record<string, PaseoScriptEntryRaw> = {};
  for (const row of input.draft.scripts) {
    const trimmedName = row.name.trim();
    if (trimmedName.length === 0) {
      continue;
    }
    const baseEntry = row.rawEntry;
    const nextEntry: Record<string, unknown> = { ...baseEntry };
    const nextCommand = lifecycleFromText(row.commandText, row.commandOriginalKind);
    if (nextCommand === undefined) {
      delete nextEntry.command;
    } else {
      nextEntry.command = nextCommand;
    }
    const trimmedType = row.type.trim();
    if (trimmedType.length === 0) {
      delete nextEntry.type;
    } else {
      nextEntry.type = trimmedType;
    }
    const nextPort = parseScriptPort(row.portText);
    if (nextPort === undefined) {
      delete nextEntry.port;
    } else {
      nextEntry.port = nextPort;
    }
    // previewUrl is service-only; drop it for plain scripts or when cleared.
    const trimmedPreviewUrl = row.previewUrlText.trim();
    if (trimmedType === "service" && trimmedPreviewUrl.length > 0) {
      nextEntry.previewUrl = trimmedPreviewUrl;
    } else {
      delete nextEntry.previewUrl;
    }
    nextScripts[trimmedName] = nextEntry as PaseoScriptEntryRaw;
  }

  const nextMetadataGeneration: Record<string, unknown> = {
    ...input.draft.metadataGenerationBase,
  };
  for (const key of METADATA_PROMPT_KEYS) {
    const text = input.draft.metadataPrompts[key];
    const baseEntry = input.draft.metadataGenerationBase?.[key] as
      | PaseoMetadataGenerationEntry
      | undefined;
    if (text.trim().length === 0) {
      if (baseEntry) {
        const nextEntry: Record<string, unknown> = { ...baseEntry };
        delete nextEntry.instructions;
        if (Object.keys(nextEntry).length === 0) {
          delete nextMetadataGeneration[key];
        } else {
          nextMetadataGeneration[key] = nextEntry;
        }
      } else {
        delete nextMetadataGeneration[key];
      }
    } else {
      nextMetadataGeneration[key] = { ...baseEntry, instructions: text };
    }
  }

  const result: Record<string, unknown> = { ...baseConfig };
  if (Object.keys(nextWorktree).length === 0) {
    delete result.worktree;
  } else {
    result.worktree = nextWorktree;
  }
  if (Object.keys(nextScripts).length === 0) {
    delete result.scripts;
  } else {
    result.scripts = nextScripts;
  }
  if (Object.keys(nextMetadataGeneration).length === 0) {
    delete result.metadataGeneration;
  } else {
    result.metadataGeneration = nextMetadataGeneration;
  }
  return result as PaseoConfigRaw;
}
