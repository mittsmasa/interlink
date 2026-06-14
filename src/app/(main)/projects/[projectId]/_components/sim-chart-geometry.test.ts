import { describe, expect, it } from "vitest";
import type { SimSnapshot } from "@/lib/diagram/simulate";
import {
  type ChartDims,
  colorForIndex,
  computeChartGeometry,
  nearestIndexForX,
  SERIES_PALETTE,
} from "./sim-chart-geometry";

const DIMS: ChartDims = {
  width: 360,
  height: 200,
  padding: { top: 12, right: 12, bottom: 24, left: 44 },
};
// area: left 44 / top 12 / right 348 / bottom 176

describe("computeChartGeometry", () => {
  it("既知 series を枠に収まる座標へ写す（端点が角に来る）", () => {
    const series: SimSnapshot[] = [
      { t: 0, 疲労: 30 },
      { t: 1, 疲労: 34 },
      { t: 2, 疲労: 38 },
      { t: 3, 疲労: 42 },
    ];
    const geo = computeChartGeometry(series, ["疲労"], DIMS);

    expect(geo.xMax).toBe(3);
    expect(geo.yMin).toBe(30);
    expect(geo.yMax).toBe(42);

    const pts = geo.lines[0].points;
    expect(pts).toHaveLength(4);
    // t=0 かつ最小値 → 左下の角
    expect(pts[0]).toEqual({ x: 44, y: 176 });
    // t=3 かつ最大値 → 右上の角
    expect(pts[3]).toEqual({ x: 348, y: 12 });
    expect(geo.lines[0].color).toBe(SERIES_PALETTE[0]);
  });

  it("空 series でも破綻せず空 points を返す", () => {
    const geo = computeChartGeometry([], ["疲労"], DIMS);
    expect(geo.xMax).toBe(0);
    expect(geo.yMin).toBe(0);
    expect(geo.yMax).toBe(1);
    expect(geo.lines[0].points).toEqual([]);
  });

  it("全値同一（y 幅 0）でも ±1 に広げて中央に線を引く", () => {
    const series: SimSnapshot[] = [
      { t: 0, 量: 5 },
      { t: 1, 量: 5 },
      { t: 2, 量: 5 },
    ];
    const geo = computeChartGeometry(series, ["量"], DIMS);
    expect(geo.yMin).toBe(4);
    expect(geo.yMax).toBe(6);
    // 値 5 は範囲 [4,6] の中央 → プロット領域の中央 y
    const midY = (12 + 176) / 2;
    for (const p of geo.lines[0].points) {
      expect(p.y).toBeCloseTo(midY, 5);
    }
  });

  it("単一ステップ（xMax=0）でも x が左端に揃う", () => {
    const geo = computeChartGeometry([{ t: 0, 量: 10 }], ["量"], DIMS);
    expect(geo.xMax).toBe(0);
    expect(geo.lines[0].points).toHaveLength(1);
    expect(geo.lines[0].points[0].x).toBe(44);
  });

  it("nearestIndexForX: 端・中間・範囲外・xMax=0 を正しく扱う", () => {
    const area = { left: 44, right: 348 };
    expect(nearestIndexForX(44, area, 3)).toBe(0); // 左端
    expect(nearestIndexForX(348, area, 3)).toBe(3); // 右端
    expect(nearestIndexForX(196, area, 3)).toBe(2); // 中央 → round(1.5)=2
    expect(nearestIndexForX(0, area, 3)).toBe(0); // 左外 → クランプ
    expect(nearestIndexForX(9999, area, 3)).toBe(3); // 右外 → クランプ
    expect(nearestIndexForX(200, area, 0)).toBe(0); // xMax=0
  });

  it("複数系列の色割り当てが名前順で決定的", () => {
    const series: SimSnapshot[] = [{ t: 0, a: 1, b: 2, c: 3 }];
    const geo1 = computeChartGeometry(series, ["a", "b", "c"], DIMS);
    const geo2 = computeChartGeometry(series, ["a", "b", "c"], DIMS);
    expect(geo1.lines.map((l) => l.color)).toEqual([
      colorForIndex(0),
      colorForIndex(1),
      colorForIndex(2),
    ]);
    expect(geo1.lines.map((l) => l.color)).toEqual(
      geo2.lines.map((l) => l.color),
    );
  });
});
