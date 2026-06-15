"use client";

import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  CircleDashedIcon,
} from "@phosphor-icons/react";
import { type Node, ViewportPortal } from "@xyflow/react";
import type { Loop, LoopPolarity } from "@/lib/diagram/loops";
import { cn } from "@/lib/utils";

/** ループ極性ごとの色。"?" は不定として中立色 */
export function loopColor(polarity: LoopPolarity): string {
  if (polarity === "R") return "var(--vermilion)";
  if (polarity === "B") return "var(--ink)";
  return "var(--muted-foreground)";
}

/** ループ極性ごとのアイコン（R=時計回り / B=反時計回り / ?=不定） */
export function LoopPolarityIcon({
  polarity,
  className,
}: {
  polarity: LoopPolarity;
  className?: string;
}) {
  if (polarity === "R") return <ArrowClockwiseIcon className={className} />;
  if (polarity === "B")
    return <ArrowCounterClockwiseIcon className={className} />;
  return <CircleDashedIcon className={className} />;
}

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

  // 重心が近いループ同士はバッジを縦にずらして団子を避ける
  const placed: { x: number; y: number }[] = [];

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
        while (placed.some((p) => Math.hypot(p.x - cx, p.y - cy) < 56)) {
          cy += 36;
        }
        placed.push({ x: cx, y: cy });

        const color = loopColor(loop.polarity);
        const path = `${loop.nodeNames.join(" → ")} → ${loop.nodeNames[0]}`;
        return (
          <div
            key={loop.id}
            className="-translate-x-1/2 -translate-y-1/2 pointer-events-auto absolute"
            style={{ left: cx, top: cy }}
          >
            <button
              type="button"
              className={cn(
                "ink-in flex cursor-default items-center gap-1 rounded-full border bg-card/90 px-2 py-0.5 font-serif text-xs shadow-sm backdrop-blur-sm",
                // 式由来の暫定ループは破線枠で「まだ確定していない」ことを示す
                loop.derived && "border-dashed",
              )}
              style={{ color, borderColor: color }}
              title={
                loop.derived
                  ? `${path}（式から推定。因果リンクを引くと確定します）`
                  : path
              }
              onMouseEnter={() => onHover(loop)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(loop)}
              onBlur={() => onHover(null)}
            >
              <LoopPolarityIcon polarity={loop.polarity} className="size-3" />
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
