// This file exists for TypeScript resolution.
// The actual implementations are in:
// - kanban-columns.native.tsx (iOS/Android)
// - kanban-columns.web.tsx (Web)
// Metro's platform-specific extensions will pick the right one at runtime.

export * from "./kanban-columns.native";
