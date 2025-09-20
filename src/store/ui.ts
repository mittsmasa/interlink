import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

export type ToolMode =
  | "select"
  | "add-stock"
  | "add-flow"
  | "add-connector"
  | "add-cloud"
  | "connect"
  | "delete";

export type ViewMode = "causal-loop" | "stock-flow" | "analysis";

export interface UIState {
  // ツール関連
  currentTool: ToolMode;
  isToolbarVisible: boolean;

  // 表示関連
  currentView: ViewMode;
  isPropertiesPanelVisible: boolean;
  isPerformanceTestVisible: boolean;
  isDebugInfoVisible: boolean;

  // キャンバス関連
  zoom: number;
  panX: number;
  panY: number;
  isGridVisible: boolean;
  isSnapToGridEnabled: boolean;
  gridSize: number;

  // モーダル・パネル関連
  activeModal: string | null;
  sidebarWidth: number;

  // パフォーマンス関連
  showFpsCounter: boolean;
  enablePerformanceMonitoring: boolean;
}

export interface UIActions {
  // ツール操作
  setCurrentTool: (tool: ToolMode) => void;
  toggleToolbar: () => void;

  // 表示切り替え
  setCurrentView: (view: ViewMode) => void;
  togglePropertiesPanel: () => void;
  togglePerformanceTest: () => void;
  toggleDebugInfo: () => void;

  // キャンバス操作
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  resetView: () => void;
  toggleGrid: () => void;
  toggleSnapToGrid: () => void;
  setGridSize: (size: number) => void;

  // モーダル・パネル操作
  openModal: (modalId: string) => void;
  closeModal: () => void;
  setSidebarWidth: (width: number) => void;

  // パフォーマンス設定
  toggleFpsCounter: () => void;
  togglePerformanceMonitoring: () => void;

  // ユーティリティ
  resetToDefaults: () => void;
}

const DEFAULT_STATE: UIState = {
  // ツール関連
  currentTool: "select",
  isToolbarVisible: true,

  // 表示関連
  currentView: "causal-loop",
  isPropertiesPanelVisible: false,
  isPerformanceTestVisible: false,
  isDebugInfoVisible: true,

  // キャンバス関連
  zoom: 1.0,
  panX: 0,
  panY: 0,
  isGridVisible: false,
  isSnapToGridEnabled: false,
  gridSize: 20,

  // モーダル・パネル関連
  activeModal: null,
  sidebarWidth: 256, // 16rem = 256px

  // パフォーマンス関連
  showFpsCounter: false,
  enablePerformanceMonitoring: false,
};

export const useUIStore = create<UIState & UIActions>()(
  immer((set, _get) => ({
    ...DEFAULT_STATE,

    // ツール操作
    setCurrentTool: (tool) =>
      set((state) => {
        state.currentTool = tool;
      }),

    toggleToolbar: () =>
      set((state) => {
        state.isToolbarVisible = !state.isToolbarVisible;
      }),

    // 表示切り替え
    setCurrentView: (view) =>
      set((state) => {
        state.currentView = view;
        // ビュー切り替え時にツールをリセット
        state.currentTool = "select";
      }),

    togglePropertiesPanel: () =>
      set((state) => {
        state.isPropertiesPanelVisible = !state.isPropertiesPanelVisible;
      }),

    togglePerformanceTest: () =>
      set((state) => {
        state.isPerformanceTestVisible = !state.isPerformanceTestVisible;
      }),

    toggleDebugInfo: () =>
      set((state) => {
        state.isDebugInfoVisible = !state.isDebugInfoVisible;
      }),

    // キャンバス操作
    setZoom: (zoom) =>
      set((state) => {
        // ズーム範囲を制限
        state.zoom = Math.max(0.1, Math.min(5.0, zoom));
      }),

    setPan: (x, y) =>
      set((state) => {
        state.panX = x;
        state.panY = y;
      }),

    resetView: () =>
      set((state) => {
        state.zoom = 1.0;
        state.panX = 0;
        state.panY = 0;
      }),

    toggleGrid: () =>
      set((state) => {
        state.isGridVisible = !state.isGridVisible;
      }),

    toggleSnapToGrid: () =>
      set((state) => {
        state.isSnapToGridEnabled = !state.isSnapToGridEnabled;
      }),

    setGridSize: (size) =>
      set((state) => {
        // グリッドサイズを制限
        state.gridSize = Math.max(10, Math.min(100, size));
      }),

    // モーダル・パネル操作
    openModal: (modalId) =>
      set((state) => {
        state.activeModal = modalId;
      }),

    closeModal: () =>
      set((state) => {
        state.activeModal = null;
      }),

    setSidebarWidth: (width) =>
      set((state) => {
        // サイドバー幅を制限
        state.sidebarWidth = Math.max(200, Math.min(600, width));
      }),

    // パフォーマンス設定
    toggleFpsCounter: () =>
      set((state) => {
        state.showFpsCounter = !state.showFpsCounter;
      }),

    togglePerformanceMonitoring: () =>
      set((state) => {
        state.enablePerformanceMonitoring = !state.enablePerformanceMonitoring;
      }),

    // ユーティリティ
    resetToDefaults: () =>
      set((state) => {
        Object.assign(state, DEFAULT_STATE);
      }),
  })),
);

// セレクター関数
export const getToolIcon = (tool: ToolMode): string => {
  switch (tool) {
    case "select":
      return "cursor-arrow";
    case "add-stock":
      return "square";
    case "add-flow":
      return "arrow-right";
    case "add-connector":
      return "circle";
    case "add-cloud":
      return "cloud";
    case "connect":
      return "link";
    case "delete":
      return "trash";
    default:
      return "cursor-arrow";
  }
};

export const getToolLabel = (tool: ToolMode): string => {
  switch (tool) {
    case "select":
      return "選択";
    case "add-stock":
      return "ストック追加";
    case "add-flow":
      return "フロー追加";
    case "add-connector":
      return "補助変数追加";
    case "add-cloud":
      return "雲追加";
    case "connect":
      return "接続";
    case "delete":
      return "削除";
    default:
      return "選択";
  }
};

export const getViewLabel = (view: ViewMode): string => {
  switch (view) {
    case "causal-loop":
      return "因果ループ図";
    case "stock-flow":
      return "ストック・フロー図";
    case "analysis":
      return "分析・グラフ";
    default:
      return "因果ループ図";
  }
};
