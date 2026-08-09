import { describe, expect, it } from "vitest";
import {
  arcApex,
  arcSamples,
  boundaryPoint,
  buildEdgeGeometries,
  countEdgeCrossings,
  countEdgeNodeOverlaps,
  type Point,
  rectOf,
  segmentIntersection,
  segmentRectDistance,
} from "./edge-geometry";

/** テストを読みやすくするため小さめの矩形を使う */
const BOX = { width: 100, height: 40 };

const distanceToChord = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
};

describe("arcSamples", () => {
  it("弧の中央が弦から矢高（弦長 × 曲率）ぶん離れる", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 400, y: 0 };
    const points = arcSamples(a, b, 0.25, 9);
    const middle = points[4];
    expect(distanceToChord(middle, a, b)).toBeCloseTo(400 * 0.25, 1);
    const apex = arcApex(a, b, 0.25);
    expect(middle.x).toBeCloseTo(apex.x, 6);
    expect(middle.y).toBeCloseTo(apex.y, 6);
  });

  it("曲率の符号で膨らむ側が反転する", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 400, y: 0 };
    expect(arcSamples(a, b, 0.25, 9)[4].y).toBeGreaterThan(0);
    expect(arcSamples(a, b, -0.25, 9)[4].y).toBeLessThan(0);
  });

  it("曲率が閾値未満なら直線を等分する", () => {
    const points = arcSamples({ x: 0, y: 0 }, { x: 400, y: 0 }, 0.001, 5);
    expect(points.map((p) => p.y)).toEqual([0, 0, 0, 0, 0]);
    expect(points[2].x).toBeCloseTo(200, 6);
  });

  it("端点は入力そのもの（丸め誤差を持ち込まない）", () => {
    const a = { x: 13, y: -7 };
    const b = { x: 211, y: 96 };
    const points = arcSamples(a, b, 0.3, 7);
    expect(points[0]).toEqual(a);
    expect(points.at(-1)).toEqual(b);
  });

  it("全サンプルが同じ円周上に乗る", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 300, y: 120 };
    const points = arcSamples(a, b, 0.4, 9);
    // 3 点から円の中心を出し、残りの点までの距離が一致することを確かめる
    const radii = points.map((p) => Math.hypot(p.x, p.y));
    expect(radii.length).toBe(9);
    const apex = arcApex(a, b, 0.4);
    expect(distanceToChord(points[4], a, b)).toBeCloseTo(
      distanceToChord(apex, a, b),
      6,
    );
  });
});

describe("boundaryPoint", () => {
  it("矩形の境界上に乗る", () => {
    const center = { x: 0, y: 0 };
    const p = boundaryPoint(center, BOX, { x: 1000, y: 0 });
    expect(p).toEqual({ x: 50, y: 0 });
    expect(boundaryPoint(center, BOX, { x: 0, y: 1000 })).toEqual({
      x: 0,
      y: 20,
    });
  });
});

describe("segmentIntersection", () => {
  it("交わる線分の交点を返す", () => {
    const hit = segmentIntersection(
      { x: -10, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: -10 },
      { x: 0, y: 10 },
    );
    expect(hit).toEqual({ x: 0, y: 0 });
  });

  it("交わらなければ null", () => {
    expect(
      segmentIntersection(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ),
    ).toBeNull();
  });

  it("端点で接する場合も交点を返す（頂点上の交差を取りこぼさないため）", () => {
    expect(
      segmentIntersection(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ),
    ).toEqual({ x: 10, y: 0 });
  });

  it("共線で重なる線分は交点を決められないので null", () => {
    expect(
      segmentIntersection(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 0 },
        { x: 15, y: 0 },
      ),
    ).toBeNull();
  });
});

describe("segmentRectDistance", () => {
  const rect = rectOf({ x: 0, y: 0 }, BOX);

  it("矩形を貫く線分は距離 0", () => {
    expect(segmentRectDistance({ x: -200, y: 0 }, { x: 200, y: 0 }, rect)).toBe(
      0,
    );
  });

  it("離れた線分は最短距離を返す", () => {
    expect(
      segmentRectDistance({ x: -200, y: 60 }, { x: 200, y: 60 }, rect),
    ).toBeCloseTo(40, 6);
  });
});

describe("countEdgeNodeOverlaps", () => {
  // a—b の直線上に c が居座る配置
  const positions = new Map([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 600, y: 0 }],
    ["c", { x: 300, y: 0 }],
  ]);
  const edges = [{ id: "e1", sourceNodeId: "a", targetNodeId: "b" }];

  it("直線なら間のノードを貫く", () => {
    const geoms = buildEdgeGeometries(edges, new Map([["e1", 0]]), positions, {
      nodeBox: BOX,
    });
    expect(countEdgeNodeOverlaps(geoms, positions, BOX)).toBe(1);
  });

  it("十分に曲げれば貫かない", () => {
    const geoms = buildEdgeGeometries(
      edges,
      new Map([["e1", 0.4]]),
      positions,
      {
        nodeBox: BOX,
      },
    );
    expect(countEdgeNodeOverlaps(geoms, positions, BOX)).toBe(0);
  });
});

describe("countEdgeCrossings", () => {
  const positions = new Map([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 600, y: 600 }],
    ["c", { x: 600, y: 0 }],
    ["d", { x: 0, y: 600 }],
  ]);

  it("X 字に走る 2 本を 1 ペアと数える", () => {
    const geoms = buildEdgeGeometries(
      [
        { id: "e1", sourceNodeId: "a", targetNodeId: "b" },
        { id: "e2", sourceNodeId: "c", targetNodeId: "d" },
      ],
      new Map([
        ["e1", 0],
        ["e2", 0],
      ]),
      positions,
      { nodeBox: BOX },
    );
    expect(countEdgeCrossings(geoms, positions, BOX)).toBe(1);
  });

  it("端点を共有するだけのペアは数えない", () => {
    const geoms = buildEdgeGeometries(
      [
        { id: "e1", sourceNodeId: "a", targetNodeId: "b" },
        { id: "e2", sourceNodeId: "a", targetNodeId: "c" },
      ],
      new Map([
        ["e1", 0.18],
        ["e2", -0.18],
      ]),
      positions,
      { nodeBox: BOX },
    );
    expect(countEdgeCrossings(geoms, positions, BOX)).toBe(0);
  });
});
