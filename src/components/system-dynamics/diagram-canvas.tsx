"use client";

import type { KonvaEventObject } from "konva/lib/Node";
import { useEffect, useRef, useState } from "react";
import { Layer, Stage } from "react-konva";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useDiagramStore } from "@/store/diagram";
import { useUIStore } from "@/store/ui";
import { DiagramConnection } from "./diagram-connection";
import { DiagramElement } from "./diagram-element";
import { PerformanceTestPanel } from "./performance-test-panel";

export function DiagramCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const { elements, connections, addElement } = useDiagramStore();
  const {
    currentTool,
    isDebugInfoVisible,
    isPerformanceTestVisible,
    togglePerformanceTest,
  } = useUIStore();

  // キーボードショートカットを有効化
  useKeyboardShortcuts();

  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        setDimensions({ width: clientWidth, height: clientHeight });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  const handleCanvasClick = (e: KonvaEventObject<MouseEvent>) => {
    // キャンバス上の空白部分をクリックした場合
    if (e.target === e.target.getStage()) {
      const pos = e.target.getStage()?.getPointerPosition();
      if (pos) {
        handleToolAction(pos);
      }
    }
  };

  const handleToolAction = (position: { x: number; y: number }) => {
    switch (currentTool) {
      case "add-stock":
        addElement({
          id: `stock-${Date.now()}`,
          type: "stock",
          position,
          size: { width: 100, height: 60 },
          label: "ストック",
          value: 0,
        });
        break;

      case "add-flow":
        addElement({
          id: `flow-${Date.now()}`,
          type: "flow",
          position,
          size: { width: 80, height: 40 },
          label: "フロー",
          value: 0,
        });
        break;

      case "add-connector":
        addElement({
          id: `connector-${Date.now()}`,
          type: "connector",
          position,
          size: { width: 60, height: 60 },
          label: "補助変数",
          value: 0,
        });
        break;

      case "add-cloud":
        addElement({
          id: `cloud-${Date.now()}`,
          type: "cloud",
          position,
          size: { width: 80, height: 60 },
          label: "雲",
          value: 0,
        });
        break;

      default:
        // 選択モードでは何もしない
        break;
    }
  };

  return (
    <div ref={containerRef} className="h-full w-full relative">
      <Stage
        width={dimensions.width}
        height={dimensions.height}
        onClick={handleCanvasClick}
        className="border-0"
      >
        <Layer>
          {/* 接続線を要素より下に描画 */}
          {connections.map((connection) => (
            <DiagramConnection key={connection.id} connection={connection} />
          ))}

          {/* 図表要素 */}
          {elements.map((element) => (
            <DiagramElement key={element.id} element={element} />
          ))}
        </Layer>
      </Stage>

      {/* デバッグ情報 */}
      {isDebugInfoVisible && (
        <div className="absolute top-4 left-4 bg-white/90 p-2 rounded shadow text-xs">
          <div>要素数: {elements.length}</div>
          <div>接続数: {connections.length}</div>
          <div>
            キャンバスサイズ: {dimensions.width}x{dimensions.height}
          </div>
          <div>現在のツール: {currentTool}</div>
        </div>
      )}

      {/* パフォーマンステストパネル */}
      <PerformanceTestPanel
        isVisible={isPerformanceTestVisible}
        onClose={() => togglePerformanceTest()}
      />
    </div>
  );
}
