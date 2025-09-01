"use client";

import { useMemo } from "react";
import { Arrow, Line } from "react-konva";
import { useDiagramStore } from "@/store/diagram";
import type { DiagramConnection as DiagramConnectionType } from "@/types/diagram";

interface DiagramConnectionProps {
  connection: DiagramConnectionType;
}

export function DiagramConnection({ connection }: DiagramConnectionProps) {
  const { getElementById } = useDiagramStore();

  const points = useMemo(() => {
    const sourceElement = getElementById(connection.sourceId);
    const targetElement = getElementById(connection.targetId);

    if (!sourceElement || !targetElement) {
      return [];
    }

    // 要素の中心点を計算
    const sourceCenter = {
      x: sourceElement.position.x + sourceElement.size.width / 2,
      y: sourceElement.position.y + sourceElement.size.height / 2,
    };

    const targetCenter = {
      x: targetElement.position.x + targetElement.size.width / 2,
      y: targetElement.position.y + targetElement.size.height / 2,
    };

    // 要素のエッジとの交点を計算（簡略化）
    const sourceEdge = getElementEdgePoint(sourceElement, targetCenter);
    const targetEdge = getElementEdgePoint(targetElement, sourceCenter);

    // カスタムポイントがある場合はそれを使用
    if (connection.points && connection.points.length > 0) {
      return [
        sourceEdge.x,
        sourceEdge.y,
        ...connection.points.flatMap((p) => [p.x, p.y]),
        targetEdge.x,
        targetEdge.y,
      ];
    }

    return [sourceEdge.x, sourceEdge.y, targetEdge.x, targetEdge.y];
  }, [connection, getElementById]);

  const getConnectionColor = () => {
    switch (connection.type) {
      case "flow":
        return "#10B981"; // emerald-500
      case "connector":
        return "#8B5CF6"; // violet-500
      default:
        return "#6B7280"; // gray-500
    }
  };

  if (points.length < 4) {
    return null;
  }

  if (connection.type === "flow") {
    return (
      <Arrow
        points={points}
        stroke={getConnectionColor()}
        strokeWidth={2}
        fill={getConnectionColor()}
        pointerLength={10}
        pointerWidth={8}
        lineCap="round"
        lineJoin="round"
      />
    );
  }

  return (
    <Line
      points={points}
      stroke={getConnectionColor()}
      strokeWidth={2}
      lineCap="round"
      lineJoin="round"
      dash={connection.type === "connector" ? [5, 5] : undefined}
    />
  );
}

// 要素のエッジポイントを計算するユーティリティ関数
function getElementEdgePoint(
  element: {
    position: { x: number; y: number };
    size: { width: number; height: number };
  },
  targetPoint: { x: number; y: number },
) {
  const centerX = element.position.x + element.size.width / 2;
  const centerY = element.position.y + element.size.height / 2;

  const dx = targetPoint.x - centerX;
  const dy = targetPoint.y - centerY;

  // 要素の境界との交点を計算
  const halfWidth = element.size.width / 2;
  const halfHeight = element.size.height / 2;

  let intersectX = centerX;
  let intersectY = centerY;

  if (Math.abs(dx) > Math.abs(dy)) {
    // 左右の境界との交点
    intersectX = centerX + (dx > 0 ? halfWidth : -halfWidth);
    intersectY = centerY + (dy * halfWidth) / Math.abs(dx);
  } else {
    // 上下の境界との交点
    intersectX = centerX + (dx * halfHeight) / Math.abs(dy);
    intersectY = centerY + (dy > 0 ? halfHeight : -halfHeight);
  }

  return { x: intersectX, y: intersectY };
}
