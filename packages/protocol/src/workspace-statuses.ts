/**
 * The workspace statuses Paseo derives on its own, in display order. A manual status may name
 * one of these or a custom status id from the host's catalog.
 */
export const WORKSPACE_AUTO_STATUSES = ["in_review", "in_progress", "backlog", "done"] as const;

export type WorkspaceAutoStatus = (typeof WORKSPACE_AUTO_STATUSES)[number];
