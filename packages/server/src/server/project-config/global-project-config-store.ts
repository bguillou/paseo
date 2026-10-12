import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  PaseoConfigRawSchema,
  type PaseoConfigRaw,
  type PaseoConfigRevision,
} from "@getpaseo/protocol/paseo-config-schema";
import type {
  ReadPaseoConfigForEditResult,
  WritePaseoConfigForEditResult,
} from "../../utils/paseo-config-file.js";

// projectIds are registry primary keys (`prj_<hex>`). Guard the filename anyway
// so a malformed id can never escape the configs directory.
const SAFE_PROJECT_ID = /^[A-Za-z0-9_-]+$/;

export interface GlobalProjectConfigStoreOptions {
  /** `$PASEO_HOME/projects/configs`. */
  configDir: string;
}

export interface WriteGlobalProjectConfigInput {
  projectId: string;
  config: PaseoConfigRaw;
  expectedRevision: PaseoConfigRevision | null;
}

/**
 * The user/global layer for a project's paseo.json, stored per project in
 * `$PASEO_HOME/projects/configs/{projectId}.json`. The body is exactly the same
 * shape as a committed paseo.json, so it is parsed with the same schema and
 * carries the same mtime/size revision used for optimistic concurrency. Writes
 * are isolated from the project registry so config edits never race the
 * reconciliation that rewrites projects.json.
 */
export class GlobalProjectConfigStore {
  private readonly configDir: string;

  constructor(options: GlobalProjectConfigStoreOptions) {
    this.configDir = options.configDir;
  }

  private configPath(projectId: string): string {
    if (!SAFE_PROJECT_ID.test(projectId)) {
      throw new Error(`Refusing global config path for unsafe projectId: ${projectId}`);
    }
    return join(this.configDir, `${projectId}.json`);
  }

  exists(projectId: string): boolean {
    return existsSync(this.configPath(projectId));
  }

  stat(projectId: string): PaseoConfigRevision | null {
    const configPath = this.configPath(projectId);
    if (!existsSync(configPath)) {
      return null;
    }
    const stats = statSync(configPath);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  }

  /** Raw JSON for the lenient runtime parse; `null` when no global config exists. */
  readRawJson(projectId: string): unknown {
    const configPath = this.configPath(projectId);
    if (!existsSync(configPath)) {
      return null;
    }
    return JSON.parse(readFileSync(configPath, "utf8"));
  }

  /** Strict read for the editor surface, mirroring `readPaseoConfigForEdit`. */
  readForEdit(projectId: string): ReadPaseoConfigForEditResult {
    try {
      const json = this.readRawJson(projectId);
      if (json === null) {
        return { ok: true, config: null, revision: null };
      }
      return {
        ok: true,
        config: PaseoConfigRawSchema.parse(json),
        revision: this.stat(projectId),
      };
    } catch {
      return { ok: false, error: { code: "invalid_project_config" } };
    }
  }

  /** Atomic write with the same optimistic-concurrency contract as the project file. */
  write(input: WriteGlobalProjectConfigInput): WritePaseoConfigForEditResult {
    const parsed = PaseoConfigRawSchema.safeParse(input.config);
    if (!parsed.success) {
      return { ok: false, error: { code: "invalid_project_config" } };
    }

    const configPath = this.configPath(input.projectId);
    const tempPath = join(this.configDir, `.${input.projectId}.${process.pid}.${randomUUID()}.tmp`);

    try {
      mkdirSync(this.configDir, { recursive: true });
      writeFileSync(tempPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
      const currentRevision = this.stat(input.projectId);
      if (!revisionsEqual(currentRevision, input.expectedRevision)) {
        removeTemp(tempPath);
        return { ok: false, error: { code: "stale_project_config", currentRevision } };
      }

      renameSync(tempPath, configPath);
      const revision = this.stat(input.projectId);
      if (!revision) {
        return { ok: false, error: { code: "write_failed" } };
      }
      return { ok: true, config: parsed.data, revision };
    } catch {
      removeTemp(tempPath);
      return { ok: false, error: { code: "write_failed" } };
    }
  }
}

function revisionsEqual(
  left: PaseoConfigRevision | null,
  right: PaseoConfigRevision | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.mtimeMs === right.mtimeMs && left.size === right.size;
}

function removeTemp(tempPath: string): void {
  try {
    rmSync(tempPath, { force: true });
  } catch {
    // Best-effort cleanup only; callers need the original write outcome.
  }
}
