"use client";

import { BaseEdge, type EdgeProps, useInternalNode } from "@xyflow/react";
import { getFloatingEdgePath } from "./floating-edge-utils";
import { useHighlight } from "./highlight-context";

/**
 * 式の依存を表す情報リンク（System Dynamics の information link）。
 * 因果リンク（実線・色・+/− ラベル）と一目で区別できるよう、
 * 破線・中立色・ラベルなしの控えめな下地として描く。保存しない導出物。
 */
export function DependencyEdge({ id, source, target }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const highlight = useHighlight();

  if (!sourceNode || !targetNode) return null;

  // 式由来リンクは暫定ループの一部になりうる。強調中のループに含まれれば濃く、
  // 含まれなければ（他ループの強調中は）dim する
  const emphasized = highlight?.edgeIds.has(id) ?? false;
  const dimmed = highlight !== null && !emphasized;

  // 軽い曲げを固定で付ける（因果エッジの bulge 計算には乗せない）
  const { path } = getFloatingEdgePath(sourceNode, targetNode, 1);

  return (
    <BaseEdge
      path={path}
      markerEnd="url(#dependency-arrow)"
      style={{
        stroke: "var(--muted-foreground)",
        strokeWidth: emphasized ? 1.8 : 1.2,
        strokeDasharray: "4 4",
        opacity: dimmed ? 0.08 : emphasized ? 0.85 : 0.55,
        transition: "opacity 200ms, stroke-width 200ms",
      }}
    />
  );
}

/** 情報リンクの矢印マーカー定義（中立色。ReactFlow 直下に一度だけ描画する） */
export function DependencyEdgeMarkers() {
  return (
    <svg aria-hidden className="absolute size-0">
      <title>情報リンクの矢印マーカー定義</title>
      <defs>
        <marker
          id="dependency-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
        </marker>
      </defs>
    </svg>
  );
}
