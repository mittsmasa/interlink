import type { SimSnapshot } from "@/lib/diagram/simulate";
import {
  type ChartDims,
  colorForIndex,
  computeChartGeometry,
} from "./sim-chart-geometry";

const DIMS: ChartDims = {
  width: 360,
  height: 200,
  padding: { top: 12, right: 12, bottom: 24, left: 44 },
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
};

/**
 * シミュレーション結果の多系列折れ線グラフ。座標計算は `computeChartGeometry`（純粋）に委ね、
 * ここは SVG とHTML 凡例の描画だけを担う presentational コンポーネント。
 */
export function SimChart({ series, names }: SimChartProps) {
  const geo = computeChartGeometry(series, names, DIMS);
  const { area } = geo;

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${geo.width} ${geo.height}`}
        className="h-auto w-full"
        role="img"
        aria-label="シミュレーション結果の時系列グラフ"
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
      </svg>

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
