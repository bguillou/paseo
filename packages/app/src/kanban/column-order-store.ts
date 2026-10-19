import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

/**
 * The kanban's column order, per device. Client-side because a custom column merges the statuses
 * of that name across hosts, so no single host's catalog order could own it. Empty means the
 * default order; ids the kanban no longer shows are ignored at read time.
 */
interface KanbanColumnOrderState {
  columnOrder: string[];
  setColumnOrder: (columnOrder: string[]) => void;
}

const KanbanColumnOrderPersistedSchema = z.strictObject({
  columnOrder: z.array(z.string()),
});

export const useBoardColumnOrderStore = create<KanbanColumnOrderState>()(
  persist<KanbanColumnOrderState, [], [], z.infer<typeof KanbanColumnOrderPersistedSchema>>(
    (set) => ({
      columnOrder: [],
      setColumnOrder: (columnOrder) => set({ columnOrder }),
    }),
    {
      name: "kanban-column-order",
      storage: createValidatedPersistStorage(AsyncStorage, KanbanColumnOrderPersistedSchema),
      version: 1,
      partialize: (state) => ({ columnOrder: state.columnOrder }),
    },
  ),
);
