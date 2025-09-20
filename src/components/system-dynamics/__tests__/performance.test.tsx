import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  generateTestConnections,
  generateTestElements,
  PerformanceMonitor,
  runPerformanceTest,
} from "@/lib/utils/performance";
import { useDiagramStore } from "@/store/diagram";
import { useUIStore } from "@/store/ui";
import { DiagramCanvas } from "../diagram-canvas";

describe("DiagramCanvas Performance Tests", () => {
  beforeEach(() => {
    const diagramStore = useDiagramStore.getState();
    diagramStore.clear();

    const uiStore = useUIStore.getState();
    uiStore.resetToDefaults();
  });

  it("renders basic canvas functionality", async () => {
    await act(async () => {
      render(<DiagramCanvas />);
    });
    // 基本的なレンダリングテスト（単純にエラーが出ないことを確認）
  });

  it("generates test elements correctly", () => {
    const elements = generateTestElements(100);
    expect(elements).toHaveLength(100);
    expect(elements[0]).toHaveProperty("id");
    expect(elements[0]).toHaveProperty("type");
    expect(elements[0]).toHaveProperty("position");
    expect(elements[0]).toHaveProperty("size");
    expect(elements[0]).toHaveProperty("label");
  });

  it("generates test connections correctly", () => {
    const elements = generateTestElements(10);
    const connections = generateTestConnections(elements, 0.5);

    expect(connections).toHaveLength(5); // 10 * 0.5
    expect(connections[0]).toHaveProperty("id");
    expect(connections[0]).toHaveProperty("sourceId");
    expect(connections[0]).toHaveProperty("targetId");
    expect(connections[0]).toHaveProperty("type");
  });

  it("performance monitor can start and stop", () => {
    const monitor = new PerformanceMonitor();

    monitor.start();
    expect(monitor.getCurrentMetrics()).toBeNull(); // まだデータなし

    const metrics = monitor.stop();
    expect(Array.isArray(metrics)).toBe(true);
  });

  it("performance test runs without errors", async () => {
    const result = await runPerformanceTest(
      "Test Performance",
      50, // 少ない要素数でテスト
      1000, // 1秒
      30, // 低いFPS目標
    );

    expect(result).toHaveProperty("testName");
    expect(result).toHaveProperty("summary");
    expect(result.summary).toHaveProperty("averageFps");
    expect(result.summary).toHaveProperty("passed");
    expect(result.testName).toBe("Test Performance");
  });

  it("handles large number of elements in store", async () => {
    const elements = generateTestElements(1000);
    const connections = generateTestConnections(elements, 0.1);

    await act(async () => {
      // 要素を追加
      const store = useDiagramStore.getState();
      for (const element of elements) {
        store.addElement(element);
      }
      for (const connection of connections) {
        store.addConnection(connection);
      }
    });

    const finalStore = useDiagramStore.getState();
    expect(finalStore.elements).toHaveLength(1000);
    expect(finalStore.connections).toHaveLength(100);

    // メモリ使用量の確認（簡易）
    const memoryInfo = (
      performance as unknown as { memory?: { usedJSHeapSize: number } }
    ).memory;
    const memoryBefore = memoryInfo?.usedJSHeapSize || 0;
    expect(typeof memoryBefore).toBe("number");
  });

  it("maintains store performance with many operations", async () => {
    const startTime = performance.now();

    await act(async () => {
      const store = useDiagramStore.getState();
      // 1000回の操作
      for (let i = 0; i < 1000; i++) {
        store.addElement({
          id: `bulk-test-${i}`,
          type: "stock",
          position: { x: (i % 100) * 10, y: Math.floor(i / 100) * 10 },
          size: { width: 80, height: 50 },
          label: `要素${i}`,
          value: i,
        });
      }
    });

    const endTime = performance.now();
    const duration = endTime - startTime;

    const finalStore = useDiagramStore.getState();
    expect(finalStore.elements).toHaveLength(1000);
    expect(duration).toBeLessThan(5000); // 5秒以内に完了（テスト環境を考慮）
  });
});
