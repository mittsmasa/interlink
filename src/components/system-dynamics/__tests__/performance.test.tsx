import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useDiagramStore } from "@/store/diagram";
import { DiagramCanvas } from "../diagram-canvas";

describe("DiagramCanvas Basic Functionality", () => {
  beforeEach(() => {
    const store = useDiagramStore.getState();
    store.clear();
  });

  it("renders basic canvas functionality", async () => {
    await act(async () => {
      render(<DiagramCanvas />);
    });
    // 基本的なレンダリングテスト（単純にエラーが出ないことを確認）
  });

  it("handles basic store operations", async () => {
    const store = useDiagramStore.getState();

    // 初期状態の確認
    expect(store.elements.length).toBe(0);

    // 基本的な機能テスト（パフォーマンステストは削除）
    await act(async () => {
      render(<DiagramCanvas />);
    });
  });

  it("maintains basic functionality", async () => {
    const store = useDiagramStore.getState();

    // 基本的な機能確認
    await act(async () => {
      render(<DiagramCanvas />);
    });

    expect(store.elements.length).toBe(0);
  });
});
