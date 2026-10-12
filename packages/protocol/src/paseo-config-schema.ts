import { z } from "zod";

const TCP_PORT_RANGE_PATTERN = /^(\d{1,5})-(\d{1,5})$/;

export const PaseoServicePortAllocationSchema = z
  .object({
    range: z.string().trim().regex(TCP_PORT_RANGE_PATTERN).optional(),
    portScript: z.string().trim().min(1).optional(),
  })
  .strict()
  .refine(
    (value) => value.range !== undefined || value.portScript !== undefined,
    "Expected range or portScript",
  )
  .refine((value) => {
    if (!value.range) return true;
    const match = TCP_PORT_RANGE_PATTERN.exec(value.range);
    if (!match) return false;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return start >= 1 && end <= 65_535 && start <= end;
  }, "Expected an inclusive TCP port range from 1-65535");

export function normalizeLifecycleCommands(commands: unknown): string[] {
  if (typeof commands === "string") {
    return commands.trim().length > 0 ? [commands] : [];
  }
  if (!Array.isArray(commands)) {
    return [];
  }
  return commands.filter((command): command is string => {
    return typeof command === "string" && command.trim().length > 0;
  });
}

export const PaseoLifecycleCommandRawSchema = z.union([z.string(), z.array(z.string())]);

export const PaseoScriptEntryRawSchema = z
  .object({
    type: z.unknown().optional(),
    command: z.unknown().optional(),
    port: z.unknown().optional(),
    // Service-only: overrides the preview URL the app opens. Supports a
    // `$PASEO_PORT` placeholder substituted with the assigned service port.
    previewUrl: z.string().optional(),
  })
  .passthrough();

export const PaseoWorktreeConfigRawSchema = z
  .object({
    setup: PaseoLifecycleCommandRawSchema.optional(),
    teardown: PaseoLifecycleCommandRawSchema.optional(),
    terminals: z.unknown().optional(),
    servicePorts: PaseoServicePortAllocationSchema.optional(),
    // Opt-in base for the per-worktree `PASEO_WORKTREE_PORT`. When set, each
    // worktree gets a deterministic port `portBase + 10 * slot` (lowest free
    // slot among live sibling worktrees) instead of a random free port.
    portBase: z.number().int().min(1).max(65535).optional(),
  })
  .passthrough();

export const PaseoMetadataGenerationEntrySchema = z
  .object({
    instructions: z.string().optional(),
  })
  .passthrough()
  .catch({});

export const PaseoMetadataGenerationSchema = z
  .object({
    title: PaseoMetadataGenerationEntrySchema.optional(),
    branchName: PaseoMetadataGenerationEntrySchema.optional(),
    commitMessage: PaseoMetadataGenerationEntrySchema.optional(),
    pullRequest: PaseoMetadataGenerationEntrySchema.optional(),
  })
  // COMPAT(projectMetadataAgentTitle): `agentTitle` project metadata prompts were removed
  // in v0.1.96; keep legacy paseo.json parseable until 2026-12-16.
  .passthrough()
  .catch({});

export const PaseoConfigRawSchema = z
  .object({
    worktree: PaseoWorktreeConfigRawSchema.optional(),
    scripts: z.record(z.string(), PaseoScriptEntryRawSchema).optional(),
    metadataGeneration: PaseoMetadataGenerationSchema.optional(),
  })
  .passthrough();

export const WorktreeConfigSchema = PaseoWorktreeConfigRawSchema.extend({
  setup: z.unknown().optional().transform(normalizeLifecycleCommands),
  teardown: z.unknown().optional().transform(normalizeLifecycleCommands),
})
  .passthrough()
  .catch({ setup: [], teardown: [] });

export const ScriptEntrySchema = PaseoScriptEntryRawSchema.catch({});

export const PaseoConfigSchema = PaseoConfigRawSchema.extend({
  worktree: WorktreeConfigSchema.optional(),
  scripts: z.record(z.string(), ScriptEntrySchema).optional().catch({}),
  metadataGeneration: PaseoMetadataGenerationSchema.optional(),
})
  .passthrough()
  .catch({});

export const PaseoConfigRevisionSchema = z.object({
  mtimeMs: z.number(),
  size: z.number(),
});

export const ProjectConfigRpcErrorSchema = z.discriminatedUnion("code", [
  z.object({ code: z.literal("project_not_found") }),
  z.object({ code: z.literal("invalid_project_config") }),
  z.object({
    code: z.literal("stale_project_config"),
    currentRevision: PaseoConfigRevisionSchema.nullable(),
  }),
  z.object({ code: z.literal("write_failed") }),
]);

// Where a project config read observes from. "project_file" is the committed
// paseo.json at the repo root; "global" is the per-project config stored in
// PASEO_HOME; "effective" is whichever one the daemon actually uses at runtime
// (project_file wins when both exist).
export const ProjectConfigSourceSchema = z.enum(["project_file", "global", "effective"]);

// Where a project config write lands. There is no "effective" target — a write
// always names a concrete layer.
export const ProjectConfigTargetSchema = z.enum(["project_file", "global"]);

export type PaseoScriptEntryRaw = z.infer<typeof PaseoScriptEntryRawSchema>;
export type PaseoMetadataGenerationEntry = z.infer<typeof PaseoMetadataGenerationEntrySchema>;
export type PaseoMetadataGeneration = z.infer<typeof PaseoMetadataGenerationSchema>;
export type PaseoServicePortAllocation = z.infer<typeof PaseoServicePortAllocationSchema>;
export type PaseoConfigRaw = z.infer<typeof PaseoConfigRawSchema>;
export type PaseoConfig = z.infer<typeof PaseoConfigSchema>;
export type PaseoConfigRevision = z.infer<typeof PaseoConfigRevisionSchema>;
export type ProjectConfigRpcError = z.infer<typeof ProjectConfigRpcErrorSchema>;
export type ProjectConfigSource = z.infer<typeof ProjectConfigSourceSchema>;
export type ProjectConfigTarget = z.infer<typeof ProjectConfigTargetSchema>;
