"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { DiagramNode } from "@/lib/queries/diagrams";
import { cn } from "@/lib/utils";
import { useHighlight } from "./highlight-context";

export type VariableNodeData = { node: DiagramNode };

type Kind = NonNullable<DiagramNode["kind"]>;

/** kind バッジの表示ラベル。未分類（null）は出さない */
const KIND_LABELS: Record<Kind, string> = {
  stock: "ストック",
  flow: "フロー",
  auxiliary: "補助変数",
  constant: "定数",
};

/**
 * kind ごとの輪郭（System Dynamics の記法に寄せる）。
 * - stock: 角ばった四角（溜まる量の器）。線を太く
 * - flow: 弁（バルブ）を示す。箱は控えめにし ValveMark を添える
 * - auxiliary: 丸（補助変数）
 * - constant: 破線の丸（固定パラメータ）
 * - null（未分類）: 従来の角丸カード
 */
const KIND_SHAPE: Record<Kind, string> = {
  stock: "rounded-none border-2",
  flow: "rounded-md",
  auxiliary: "rounded-full px-5",
  constant: "rounded-full border-dashed px-5",
};

/** フローの弁（バルブ）記号。蝶ネクタイ型の三角 2 つで「流量を絞る弁」を表す */
function ValveMark() {
  return (
    <svg
      viewBox="0 0 16 10"
      className="mx-auto mb-0.5 block h-2.5 w-4"
      aria-hidden
    >
      <title>弁</title>
      <path
        d="M1 1 L8 5 L1 9 Z M15 1 L8 5 L15 9 Z"
        className="fill-card stroke-muted-foreground"
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VariableNode({ data, selected }: NodeProps) {
  const { node } = data as VariableNodeData;
  const kind = node.kind;
  const kindLabel = kind ? KIND_LABELS[kind] : null;
  const highlight = useHighlight();
  const emphasized = highlight?.nodeIds.has(node.id) ?? false;
  const dimmed = highlight !== null && !highlight.nodeIds.has(node.id);
  return (
    // ink-in（fill-mode: both）が opacity を保持し続けるため、減光は外側で行う
    <div
      className={cn(
        "group transition-opacity duration-200",
        dimmed && "opacity-20",
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-1.5 !border-muted-foreground/60 !bg-muted-foreground/40 !opacity-0 transition-opacity group-hover:!opacity-100"
      />
      <div
        className={cn(
          "ink-in border bg-card px-4 py-2 shadow-sm transition-shadow",
          kind ? KIND_SHAPE[kind] : "rounded-md",
          (selected || emphasized) && "border-ring shadow-md",
        )}
      >
        <div className="max-w-40 text-center">
          {kind === "flow" && <ValveMark />}
          {kindLabel && (
            <span className="mb-0.5 block text-[9px] tracking-wide text-muted-foreground">
              {kindLabel}
            </span>
          )}
          <span className="font-serif text-sm leading-snug">{node.name}</span>
          {node.unit && (
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              [{node.unit}]
            </span>
          )}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-1.5 !border-muted-foreground/60 !bg-muted-foreground/40 !opacity-0 transition-opacity group-hover:!opacity-100"
      />
    </div>
  );
}
