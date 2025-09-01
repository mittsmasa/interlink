"use client";

import type { KonvaEventObject } from "konva/lib/Node";
import { useEffect, useRef, useState } from "react";
import { Layer, Stage } from "react-konva";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useDiagramStore } from "@/store/diagram";
import { DiagramConnection } from "./diagram-connection";
import { DiagramElement } from "./diagram-element";

export function DiagramCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  const { elements, connections, addElement } = useDiagramStore();

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
        // テスト用：クリックした位置に要素を追加
        addElement({
          id: `element-${Date.now()}`,
          type: "stock",
          position: { x: pos.x, y: pos.y },
          size: { width: 100, height: 60 },
          label: "新しい要素",
          value: 0,
        });
      }
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
      <div className="absolute top-4 left-4 bg-white/90 p-2 rounded shadow text-xs">
        <div>要素数: {elements.length}</div>
        <div>接続数: {connections.length}</div>
        <div>
          キャンバスサイズ: {dimensions.width}x{dimensions.height}
        </div>
      </div>
    </div>
  );
}
