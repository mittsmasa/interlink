import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDiagramStore } from "@/store/diagram";
import type { DiagramElement } from "@/types/diagram";
import { DiagramCanvas } from "../diagram-canvas";

describe("DiagramCanvas Performance", () => {
  beforeEach(() => {
    const store = useDiagramStore.getState();
    store.clear();
  });

  it(
    "renders with 1000 elements within acceptable time",
    async () => {
      const store = useDiagramStore.getState();

      // 1000個の要素を追加
      const elements: DiagramElement[] = [];
      for (let i = 0; i < 1000; i++) {
        elements.push({
          id: `element-${i}`,
          type: "stock",
          position: {
            x: (i % 40) * 120 + 50,
            y: Math.floor(i / 40) * 80 + 50,
          },
          size: { width: 100, height: 60 },
          label: `要素 ${i}`,
          value: Math.random() * 100,
        });
      }

      const startTime = performance.now();

      // 要素を一括で追加（実際のアプリでは段階的に追加される）
      for (const element of elements) {
        store.addElement(element);
      }

      const addTime = performance.now() - startTime;
      expect(addTime).toBeLessThan(1000); // 1秒以内で追加完了

      const renderStartTime = performance.now();
      render(<DiagramCanvas />);
      const renderTime = performance.now() - renderStartTime;

      // レンダリング時間のテスト（目安: 2秒以内）
      expect(renderTime).toBeLessThan(2000);

      // 要素数の確認
      expect(useDiagramStore.getState().elements.length).toBe(1000);
    },
    { timeout: 10000 },
  );

  it("handles rapid element addition without memory leaks", async () => {
    const store = useDiagramStore.getState();

    // 短時間で100個の要素を追加
    const startTime = performance.now();

    for (let i = 0; i < 100; i++) {
      store.addElement({
        id: `rapid-element-${i}`,
        type: "flow",
        position: { x: i * 10, y: i * 10 },
        size: { width: 80, height: 40 },
        label: `高速要素 ${i}`,
        value: i,
      });
    }

    const addTime = performance.now() - startTime;
    expect(addTime).toBeLessThan(100); // 100ms以内

    render(<DiagramCanvas />);

    expect(store.elements.length).toBe(100);
  });

  it("efficiently updates elements without full re-render", async () => {
    const store = useDiagramStore.getState();

    // 10個の要素を追加
    for (let i = 0; i < 10; i++) {
      store.addElement({
        id: `update-element-${i}`,
        type: "stock",
        position: { x: i * 50, y: 100 },
        size: { width: 100, height: 60 },
        label: `更新要素 ${i}`,
        value: 0,
      });
    }

    render(<DiagramCanvas />);

    // 要素の値を更新
    const updateStartTime = performance.now();

    for (let i = 0; i < 10; i++) {
      store.updateElement(`update-element-${i}`, { value: i * 10 });
    }

    const updateTime = performance.now() - updateStartTime;
    expect(updateTime).toBeLessThan(50); // 50ms以内で更新完了
  });

  it("handles selection of many elements efficiently", async () => {
    const store = useDiagramStore.getState();

    // 100個の要素を追加
    for (let i = 0; i < 100; i++) {
      store.addElement({
        id: `select-element-${i}`,
        type: "connector",
        position: { x: (i % 10) * 80, y: Math.floor(i / 10) * 70 },
        size: { width: 60, height: 60 },
        label: `選択要素 ${i}`,
        value: 0,
      });
    }

    render(<DiagramCanvas />);

    // 全要素を選択
    const selectionStartTime = performance.now();
    const allIds = store.elements.map((el) => el.id);
    store.selectElements(allIds);
    const selectionTime = performance.now() - selectionStartTime;

    expect(selectionTime).toBeLessThan(100); // 100ms以内で選択完了
    expect(store.selectedElementIds.length).toBe(100);
  });

  it("maintains performance with complex history operations", async () => {
    const store = useDiagramStore.getState();

    // 初期スナップショットを保存
    store.saveSnapshot();

    const operationStartTime = performance.now();

    // 50回の操作を実行
    for (let i = 0; i < 50; i++) {
      store.addElement({
        id: `history-element-${i}`,
        type: "stock",
        position: { x: i * 20, y: 100 },
        size: { width: 100, height: 60 },
        label: `履歴要素 ${i}`,
        value: i,
      });

      if (i % 10 === 0) {
        store.saveSnapshot();
      }
    }

    const operationTime = performance.now() - operationStartTime;
    expect(operationTime).toBeLessThan(500); // 500ms以内

    // アンドゥ操作のパフォーマンス
    const undoStartTime = performance.now();
    for (let i = 0; i < 5; i++) {
      if (store.canUndo()) {
        store.undo();
      }
    }
    const undoTime = performance.now() - undoStartTime;

    expect(undoTime).toBeLessThan(100); // 100ms以内
  });
});
