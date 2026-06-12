"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import type { DiagramNode } from "@/lib/queries/diagrams";
import { cn } from "@/lib/utils";
import { useHighlight } from "./highlight-context";

export type VariableNodeData = { node: DiagramNode };

export function VariableNode({ data, selected }: NodeProps) {
  const { node } = data as VariableNodeData;
  const highlight = useHighlight();
  const emphasized = highlight?.nodeIds.has(node.id) ?? false;
  const dimmed = highlight !== null && !highlight.nodeIds.has(node.id);
  return (
    // ink-in（fill-mode: both）が opacity を保持し続けるため、減光は外側で行う
    <div
      className={cn("transition-opacity duration-200", dimmed && "opacity-20")}
    >
      <div
        className={cn(
          "ink-in rounded-md border bg-card px-4 py-2 shadow-sm transition-shadow",
          (selected || emphasized) && "border-ring shadow-md",
        )}
      >
        {/* エッジはフローティング描画のため、ハンドルは接続解決用に不可視で置く */}
        <Handle
          type="target"
          position={Position.Top}
          className="!opacity-0 !pointer-events-none"
        />
        <div className="max-w-40 text-center">
          <span className="font-serif text-sm leading-snug">{node.name}</span>
          {node.unit && (
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              [{node.unit}]
            </span>
          )}
        </div>
        <Handle
          type="source"
          position={Position.Top}
          className="!opacity-0 !pointer-events-none"
        />
      </div>
    </div>
  );
}
