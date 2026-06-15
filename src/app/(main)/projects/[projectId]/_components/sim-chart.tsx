"use client";

import { useState } from "react";
import type { SimSnapshot } from "@/lib/diagram/simulate";
import {
  type ChartDims,
  colorForIndex,
  computeChartGeometry,
  nearestIndexForX,
} from "./sim-chart-geometry";

const DEFAULT_DIMS: ChartDims = {
  width: 360,
  height: 200,
  padding: { top: 12, right: 12, bottom: 24, left: 44 },
};

/** 拡大表示用の大きい寸法（軸ラベルなどが相対的に綺麗になる） */
export const LARGE_DIMS: ChartDims = {
  width: 760,
  height: 420,
  padding: { top: 16, right: 16, bottom: 32, left: 56 },
};

/** 目盛り値を読みやすい桁に丸める（整数なら整数、端数は小数 2 桁） */
function formatTick(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}

type SimChartProps = {
  series: SimSnapshot[];
  /** 描画する系列（ノード名）。色は配列順で決まる */
  names: string[];
  /** 描画寸法。既定はパネル内の小サイズ。拡大時は LARGE_DIMS を渡す */
  dims?: ChartDims;
};

/**
 * シミュレーション結果の多系列折れ線グラフ。座標計算は `computeChartGeometry`（純粋）に委ね、
 * ここは SVG・HTML 凡例・ホバー時の値表示を担う。ホバーは最近傍の t を縦ガイド線 +
 * ツールチップで示す。
 */
export function SimChart({
  series,
  names,
  dims = DEFAULT_DIMS,
}: SimChartProps) {
  const geo = computeChartGeometry(series, names, dims);
  const { area } = geo;
  const [hover, setHover] = useState<number | null>(null);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (geo.lines.length === 0) return;
    const svg = e.currentTarget;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    setHover(nearestIndexForX(local.x, area, geo.xMax));
  };

  const hoverX =
    hover !== null ? (geo.lines[0]?.points[hover]?.x ?? null) : null;
  // ツールチップの左位置（コンテナ幅に対する %）。viewBox 幅に対する比で出す
  const hoverLeftPct = hoverX !== null ? (hoverX / geo.width) * 100 : 0;
  const hoverSnap = hover !== null ? series[hover] : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg
          viewBox={`0 0 ${geo.width} ${geo.height}`}
          className="h-auto w-full"
          role="img"
          aria-label="シミュレーション結果の時系列グラフ"
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* y 軸の目盛り線とラベル */}
          {geo.yTicks.map((tick) => (
            <g key={`y-${tick.value}`}>
              <line
                x1={area.left}
                y1={tick.y}
                x2={area.right}
                y2={tick.y}
                stroke="var(--grid-line)"
                strokeWidth={1}
              />
              <text
                x={area.left - 6}
                y={tick.y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[9px]"
              >
                {formatTick(tick.value)}
              </text>
            </g>
          ))}

          {/* x 軸の基線と両端の t ラベル */}
          <line
            x1={area.left}
            y1={area.bottom}
            x2={area.right}
            y2={area.bottom}
            stroke="var(--grid-line)"
            strokeWidth={1}
          />
          <text
            x={area.left}
            y={area.bottom + 14}
            textAnchor="start"
            className="fill-muted-foreground text-[9px]"
          >
            t=0
          </text>
          <text
            x={area.right}
            y={area.bottom + 14}
            textAnchor="end"
            className="fill-muted-foreground text-[9px]"
          >
            t={geo.xMax}
          </text>

          {/* ホバー位置の縦ガイド線 */}
          {hoverX !== null && (
            <line
              x1={hoverX}
              y1={area.top}
              x2={hoverX}
              y2={area.bottom}
              stroke="var(--grid-line)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* 各系列の折れ線（1 点のみのときは点で表す） */}
          {geo.lines.map((line) =>
            line.points.length === 1 ? (
              <circle
                key={line.name}
                cx={line.points[0].x}
                cy={line.points[0].y}
                r={2.5}
                fill={line.color}
              />
            ) : (
              <polyline
                key={line.name}
                points={line.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={line.color}
                strokeWidth={1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ),
          )}

          {/* ホバー位置の各系列の点 */}
          {hover !== null &&
            geo.lines.map((line) => {
              const p = line.points[hover];
              if (!p) return null;
              return (
                <circle
                  key={`h-${line.name}`}
                  cx={p.x}
                  cy={p.y}
                  r={3}
                  fill={line.color}
                  stroke="var(--card)"
                  strokeWidth={1}
                />
              );
            })}
        </svg>

        {/* ホバー時のツールチップ（HTML） */}
        {hover !== null && hoverSnap && geo.lines.length > 0 && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border bg-card/95 px-2 py-1 text-[11px] shadow-md backdrop-blur-sm"
            style={{
              left: `${Math.min(85, Math.max(15, hoverLeftPct))}%`,
            }}
          >
            <div className="mb-0.5 text-muted-foreground">t={hover}</div>
            <ul className="space-y-0.5">
              {geo.lines.map((line) => (
                <li
                  key={`tt-${line.name}`}
                  className="flex items-center gap-1.5"
                >
                  <span
                    aria-hidden
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: line.color }}
                  />
                  <span className="text-muted-foreground">{line.name}</span>
                  <span className="ml-auto font-medium tabular-nums">
                    {formatTick(hoverSnap[line.name])}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 凡例（折り返し可能な HTML） */}
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {names.map((name, index) => (
          <li
            key={name}
            className="flex items-center gap-1.5 text-muted-foreground text-xs"
          >
            <span
              aria-hidden
              className="inline-block size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colorForIndex(index) }}
            />
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}
