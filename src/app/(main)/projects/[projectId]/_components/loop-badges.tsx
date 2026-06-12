"use client";

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { type Node, ViewportPortal } from "@xyflow/react";
import type { Loop } from "@/lib/diagram/loops";

type LoopBadgesProps = {
  loops: Loop[];
  /** React Flow のライブなノード state（ドラッグに追従させる） */
  liveNodes: Node[];
  onHover: (loop: Loop | null) => void;
};

/** 各ループの重心に R/B バッジを置く。hover でそのループを強調する */
export function LoopBadges({ loops, liveNodes, onHover }: LoopBadgesProps) {
  const centerById = new Map(
    liveNodes.map((node) => [
      node.id,
      {
        x: node.position.x + (node.measured?.width ?? 120) / 2,
        y: node.position.y + (node.measured?.height ?? 40) / 2,
      },
    ]),
  );

  return (
    <ViewportPortal>
      {loops.map((loop) => {
        const points = loop.nodeIds
          .map((id) => centerById.get(id))
          .filter((p) => p !== undefined);
        if (points.length === 0) return null;
        const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
        let cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
        // 自己ループは重心がノード中心と重なるため、弧の上に逃がす
        if (loop.nodeIds.length === 1) cy -= 110;

        const isReinforcing = loop.polarity === "R";
        const color = isReinforcing ? "var(--vermilion)" : "var(--ink)";
        return (
          <div
            key={loop.id}
            className="-translate-x-1/2 -translate-y-1/2 pointer-events-auto absolute"
            style={{ left: cx, top: cy }}
          >
            <button
              type="button"
              className="ink-in flex cursor-default items-center gap-1 rounded-full border bg-card/90 px-2 py-0.5 font-serif text-xs shadow-sm backdrop-blur-sm"
              style={{ color, borderColor: color }}
              title={`${loop.nodeNames.join(" → ")} → ${loop.nodeNames[0]}`}
              onMouseEnter={() => onHover(loop)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(loop)}
              onBlur={() => onHover(null)}
            >
              {isReinforcing ? (
                <ArrowClockwiseIcon className="size-3" />
              ) : (
                <ArrowCounterClockwiseIcon className="size-3" />
              )}
              <span>{loop.label}</span>
              {loop.hasDelay && (
                <span className="tracking-tighter" title="遅れを含む">
                  ∥
                </span>
              )}
            </button>
          </div>
        );
      })}
    </ViewportPortal>
  );
}
