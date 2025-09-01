import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useDiagramStore } from "@/store/diagram";
import { DiagramCanvas } from "../diagram-canvas";

describe("DiagramCanvas", () => {
  beforeEach(() => {
    // ストアをリセット
    const store = useDiagramStore.getState();
    store.clear();
  });

  it("renders without crashing", async () => {
    render(<DiagramCanvas />);

    // Konvaキャンバスが描画されるまで待機
    await waitFor(() => {
      expect(document.querySelector("canvas")).toBeInTheDocument();
    });
  });

  it("displays debug information", async () => {
    render(<DiagramCanvas />);

    await waitFor(() => {
      expect(screen.getByText(/要素数: 0/)).toBeInTheDocument();
      expect(screen.getByText(/接続数: 0/)).toBeInTheDocument();
      expect(screen.getByText(/キャンバスサイズ:/)).toBeInTheDocument();
    });
  });

  it("updates debug information when elements are added", async () => {
    const { rerender } = render(<DiagramCanvas />);

    // 要素を追加
    const store = useDiagramStore.getState();
    store.addElement({
      id: "test-element",
      type: "stock",
      position: { x: 100, y: 100 },
      size: { width: 100, height: 60 },
      label: "テスト要素",
      value: 0,
    });

    rerender(<DiagramCanvas />);

    await waitFor(() => {
      expect(screen.getByText(/要素数: 1/)).toBeInTheDocument();
    });
  });

  it("adds element when canvas is clicked", async () => {
    const user = userEvent.setup();
    render(<DiagramCanvas />);

    // キャンバスがレンダリングされるまで待機
    await waitFor(() => {
      expect(document.querySelector("canvas")).toBeInTheDocument();
    });

    const canvas = document.querySelector("canvas");
    if (canvas) {
      await user.click(canvas);

      await waitFor(() => {
        expect(screen.getByText(/要素数: 1/)).toBeInTheDocument();
      });
    }
  });
});
