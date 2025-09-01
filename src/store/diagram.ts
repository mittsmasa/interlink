import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  DiagramConnection,
  DiagramElement,
  DiagramSnapshot,
  DiagramState,
} from "@/types/diagram";

interface DiagramActions {
  // 要素操作
  addElement: (element: DiagramElement) => void;
  updateElement: (id: string, updates: Partial<DiagramElement>) => void;
  removeElement: (id: string) => void;
  moveElement: (id: string, position: { x: number; y: number }) => void;

  // 接続操作
  addConnection: (connection: DiagramConnection) => void;
  updateConnection: (id: string, updates: Partial<DiagramConnection>) => void;
  removeConnection: (id: string) => void;

  // 選択操作
  selectElement: (id: string) => void;
  selectElements: (ids: string[]) => void;
  toggleElementSelection: (id: string) => void;
  clearSelection: () => void;

  // 履歴操作
  saveSnapshot: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // クリップボード操作
  copy: () => void;
  paste: (offsetX?: number, offsetY?: number) => void;

  // ユーティリティ
  clear: () => void;
  getElementById: (id: string) => DiagramElement | undefined;
  getConnectionById: (id: string) => DiagramConnection | undefined;
  getSelectedElements: () => DiagramElement[];
}

const MAX_HISTORY_SIZE = 50;
const PASTE_OFFSET = 20;

// カスタムクローン関数（structuredCloneの代替）
function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as unknown as T;
  }

  if (typeof obj === "object") {
    const cloned = {} as Record<string, unknown>;
    for (const [key, value] of Object.entries(obj)) {
      cloned[key] = deepClone(value);
    }
    return cloned as T;
  }

  return obj;
}

export const useDiagramStore = create<DiagramState & DiagramActions>()(
  immer((set, get) => ({
    // 初期状態
    elements: [],
    connections: [],
    selectedElementIds: [],
    history: [],
    historyIndex: -1,
    clipboard: null,

    // 要素操作
    addElement: (element) =>
      set((state) => {
        state.elements.push(element);
        get().saveSnapshot();
      }),

    updateElement: (id, updates) =>
      set((state) => {
        const element = state.elements.find((el) => el.id === id);
        if (element) {
          Object.assign(element, updates);
        }
      }),

    removeElement: (id) =>
      set((state) => {
        state.elements = state.elements.filter((el) => el.id !== id);
        state.connections = state.connections.filter(
          (conn) => conn.sourceId !== id && conn.targetId !== id,
        );
        state.selectedElementIds = state.selectedElementIds.filter(
          (selectedId) => selectedId !== id,
        );
        get().saveSnapshot();
      }),

    moveElement: (id, position) =>
      set((state) => {
        const element = state.elements.find((el) => el.id === id);
        if (element) {
          element.position = position;
        }
      }),

    // 接続操作
    addConnection: (connection) =>
      set((state) => {
        state.connections.push(connection);
        get().saveSnapshot();
      }),

    updateConnection: (id, updates) =>
      set((state) => {
        const connection = state.connections.find((conn) => conn.id === id);
        if (connection) {
          Object.assign(connection, updates);
        }
      }),

    removeConnection: (id) =>
      set((state) => {
        state.connections = state.connections.filter((conn) => conn.id !== id);
        get().saveSnapshot();
      }),

    // 選択操作
    selectElement: (id) =>
      set((state) => {
        state.selectedElementIds = [id];
        state.elements.forEach((el) => {
          el.selected = el.id === id;
        });
      }),

    selectElements: (ids) =>
      set((state) => {
        state.selectedElementIds = ids;
        state.elements.forEach((el) => {
          el.selected = ids.includes(el.id);
        });
      }),

    toggleElementSelection: (id) =>
      set((state) => {
        const isSelected = state.selectedElementIds.includes(id);
        if (isSelected) {
          state.selectedElementIds = state.selectedElementIds.filter(
            (selectedId) => selectedId !== id,
          );
        } else {
          state.selectedElementIds.push(id);
        }

        const element = state.elements.find((el) => el.id === id);
        if (element) {
          element.selected = !isSelected;
        }
      }),

    clearSelection: () =>
      set((state) => {
        state.selectedElementIds = [];
        state.elements.forEach((el) => {
          el.selected = false;
        });
      }),

    // 履歴操作
    saveSnapshot: () =>
      set((state) => {
        const snapshot: DiagramSnapshot = {
          elements: deepClone(state.elements),
          connections: deepClone(state.connections),
          timestamp: Date.now(),
        };

        // 現在のインデックス以降の履歴を削除
        state.history = state.history.slice(0, state.historyIndex + 1);
        state.history.push(snapshot);

        // 履歴サイズ制限
        if (state.history.length > MAX_HISTORY_SIZE) {
          state.history = state.history.slice(-MAX_HISTORY_SIZE);
        }

        state.historyIndex = state.history.length - 1;
      }),

    undo: () =>
      set((state) => {
        if (get().canUndo()) {
          state.historyIndex--;
          const snapshot = state.history[state.historyIndex];
          if (snapshot) {
            state.elements = deepClone(snapshot.elements);
            state.connections = deepClone(snapshot.connections);
            state.selectedElementIds = [];
          }
        }
      }),

    redo: () =>
      set((state) => {
        if (get().canRedo()) {
          state.historyIndex++;
          const snapshot = state.history[state.historyIndex];
          if (snapshot) {
            state.elements = deepClone(snapshot.elements);
            state.connections = deepClone(snapshot.connections);
            state.selectedElementIds = [];
          }
        }
      }),

    canUndo: () => {
      const state = get();
      return state.historyIndex > 0;
    },

    canRedo: () => {
      const state = get();
      return state.historyIndex < state.history.length - 1;
    },

    // クリップボード操作
    copy: () =>
      set((state) => {
        const selectedElements = state.elements.filter((el) =>
          state.selectedElementIds.includes(el.id),
        );
        const selectedConnections = state.connections.filter(
          (conn) =>
            state.selectedElementIds.includes(conn.sourceId) &&
            state.selectedElementIds.includes(conn.targetId),
        );

        if (selectedElements.length > 0) {
          state.clipboard = {
            elements: deepClone(selectedElements),
            connections: deepClone(selectedConnections),
          };
        }
      }),

    paste: (offsetX = PASTE_OFFSET, offsetY = PASTE_OFFSET) =>
      set((state) => {
        if (!state.clipboard) return;

        const idMapping = new Map<string, string>();
        const newElements = state.clipboard.elements.map((element) => {
          const newId = `${element.id}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
          idMapping.set(element.id, newId);

          return {
            ...element,
            id: newId,
            position: {
              x: element.position.x + offsetX,
              y: element.position.y + offsetY,
            },
            selected: false,
          };
        });

        const newConnections = state.clipboard.connections
          .map((connection) => {
            const newSourceId = idMapping.get(connection.sourceId);
            const newTargetId = idMapping.get(connection.targetId);

            if (!newSourceId || !newTargetId) return null;

            return {
              ...connection,
              id: `${connection.id}-copy-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
              sourceId: newSourceId,
              targetId: newTargetId,
            };
          })
          .filter((conn): conn is DiagramConnection => conn !== null);

        state.elements.push(...newElements);
        state.connections.push(...newConnections);

        // 新しい要素を選択
        state.selectedElementIds = newElements.map((el) => el.id);
        state.elements.forEach((el) => {
          el.selected = state.selectedElementIds.includes(el.id);
        });

        get().saveSnapshot();
      }),

    // ユーティリティ
    clear: () =>
      set((state) => {
        state.elements = [];
        state.connections = [];
        state.selectedElementIds = [];
        state.clipboard = null;
        get().saveSnapshot();
      }),

    getElementById: (id) => {
      return get().elements.find((el) => el.id === id);
    },

    getConnectionById: (id) => {
      return get().connections.find((conn) => conn.id === id);
    },

    getSelectedElements: () => {
      const state = get();
      return state.elements.filter((el) =>
        state.selectedElementIds.includes(el.id),
      );
    },
  })),
);
