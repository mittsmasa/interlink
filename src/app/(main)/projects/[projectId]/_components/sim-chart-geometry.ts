import type { SimSnapshot } from "@/lib/diagram/simulate";

/**
 * 系列の色パレット。彩度を抑えた中間トーンで、明背景（和紙）でも暗背景でも読める。
 * 名前順の index で決定的に割り当てる（テストで固定できるよう純粋に保つ）。
 */
export const SERIES_PALETTE = [
  "#c8553d", // vermilion 寄り（アプリのアクセント色調）
  "#4a5a8a", // indigo
  "#3f7d72", // teal
  "#b07d34", // amber
  "#8a5a7a", // plum
  "#5a6670", // slate
] as const;

export function colorForIndex(index: number): string {
  return SERIES_PALETTE[index % SERIES_PALETTE.length];
}

export type ChartPoint = { x: number; y: number };

export type ChartLine = {
  name: string;
  color: string;
  points: ChartPoint[];
};

export type ChartDims = {
  width: number;
  height: number;
  /** プロット領域の余白（軸ラベル/凡例の場所を確保） */
  padding: { top: number; right: number; bottom: number; left: number };
};

export type ChartGeometry = {
  lines: ChartLine[];
  /** プロット領域の SVG 矩形 */
  area: { left: number; top: number; right: number; bottom: number };
  yMin: number;
  yMax: number;
  xMax: number;
  /** y 軸の目盛り（値と SVG y 座標） */
  yTicks: { value: number; y: number }[];
  width: number;
  height: number;
};

/**
 * シミュレーション結果（series）から SVG 折れ線の座標を決定的に計算する純粋関数。
 *
 * - x は t（0..steps-1）を等間隔で割り付ける。steps=1（xMax=0）でも破綻しない
 * - y は全系列の min/max にスケール。全値同一（範囲 0）でも ±1 に広げて中央に線を引く
 * - 色は names の順番（index）で `SERIES_PALETTE` から決定的に割り当てる
 *
 * names は描画対象のノード名（series のキー）。空 series / 空 names でも安全に空 geometry を返す。
 */
export function computeChartGeometry(
  series: SimSnapshot[],
  names: string[],
  dims: ChartDims,
): ChartGeometry {
  const { width, height, padding } = dims;
  const area = {
    left: padding.left,
    top: padding.top,
    right: width - padding.right,
    bottom: height - padding.bottom,
  };

  const xMax = series.length > 0 ? series.length - 1 : 0;

  // 全系列・全ステップを走査して y の範囲を求める
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const snap of series) {
    for (const name of names) {
      const v = snap[name];
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
  }
  // 値が 1 つも無い / 範囲ゼロのときの保険
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 0;
    yMax = 1;
  } else if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }

  const xFor = (t: number): number =>
    xMax === 0 ? area.left : area.left + (t / xMax) * (area.right - area.left);
  const yFor = (v: number): number =>
    area.bottom - ((v - yMin) / (yMax - yMin)) * (area.bottom - area.top);

  const lines: ChartLine[] = names.map((name, index) => ({
    name,
    color: colorForIndex(index),
    points: series.map((snap, t) => ({ x: xFor(t), y: yFor(snap[name]) })),
  }));

  const yTicks = [
    { value: yMax, y: yFor(yMax) },
    { value: (yMin + yMax) / 2, y: yFor((yMin + yMax) / 2) },
    { value: yMin, y: yFor(yMin) },
  ];

  return { lines, area, yMin, yMax, xMax, yTicks, width, height };
}
