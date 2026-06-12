"use client";

import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  useInternalNode,
} from "@xyflow/react";
import type { DiagramEdge } from "@/lib/queries/diagrams";
import { cn } from "@/lib/utils";
import { type BulgeSign, getFloatingEdgePath } from "./floating-edge-utils";

export type CausalEdgeData = { edge: DiagramEdge; bulgeSign?: BulgeSign };

export function CausalEdge({ id, source, target, data, selected }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const { edge, bulgeSign } = data as CausalEdgeData;

  if (!sourceNode || !targetNode) return null;

  const { path, labelX, labelY } = getFloatingEdgePath(
    sourceNode,
    targetNode,
    bulgeSign ?? 1,
  );
  const isNegative = edge.polarity === "-";
  const color = isNegative ? "var(--vermilion)" : "var(--ink)";

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#causal-arrow-${isNegative ? "neg" : "pos"})`}
        style={{
          stroke: color,
          strokeWidth: selected ? 2.4 : 1.6,
        }}
      />
      <EdgeLabelRenderer>
        {/* 位置決めの transform と ink-in の transform が衝突しないよう分離する */}
        <div
          className="pointer-events-none absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <div
            className={cn(
              "ink-in flex items-center gap-1 rounded-full border bg-card px-1.5 py-0.5 font-serif shadow-sm",
              selected && "ring-1 ring-ring",
            )}
            style={{ color, borderColor: color }}
          >
            <span className="text-base leading-none">
              {edge.polarity === "+" ? "+" : "−"}
            </span>
            {edge.hasDelay && (
              <span
                className="text-sm leading-none tracking-tighter"
                title="遅れ"
              >
                ∥
              </span>
            )}
          </div>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

/** 極性ごとの矢印マーカー定義（ReactFlow 直下に一度だけ描画する） */
export function CausalEdgeMarkers() {
  return (
    <svg aria-hidden className="absolute size-0">
      <title>因果リンクの矢印マーカー定義</title>
      <defs>
        <marker
          id="causal-arrow-pos"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink)" />
        </marker>
        <marker
          id="causal-arrow-neg"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--vermilion)" />
        </marker>
      </defs>
    </svg>
  );
}
