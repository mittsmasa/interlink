import type { InternalNode } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { detectLoops } from "@/lib/diagram/loops";
import type { Diagram } from "@/lib/queries/diagrams";
import {
  arcApex,
  buildEdgeGeometries,
  countEdgeCrossings,
  countEdgeNodeOverlaps,
  type EdgeRef,
  NODE_BOX,
  type Point,
  STRAIGHT_EPSILON,
} from "./edge-geometry";
import {
  chooseEdgeCurvatures,
  chooseEdgeRouting,
  chooseSelfLoopAngles,
  DEFAULT_CURVATURE,
  DEFAULT_SELF_LOOP_ANGLE,
  getFloatingEdgePath,
  heuristicCurvatures,
  MAX_OPTIMIZED_EDGES,
} from "./floating-edge-utils";
import { computePositions, selectRingNodeIds } from "./layout-diagram";

const node = (id: string, x: number, y: number): InternalNode =>
  ({
    id,
    measured: { width: NODE_BOX.width, height: NODE_BOX.height },
    internals: {
      positionAbsolute: {
        x: x - NODE_BOX.width / 2,
        y: y - NODE_BOX.height / 2,
      },
    },
  }) as unknown as InternalNode;

describe("getFloatingEdgePath", () => {
  const a = node("a", 0, 0);
  const b = node("b", 600, 0);

  it("曲率が閾値未満なら直線を引く", () => {
    const { path } = getFloatingEdgePath(a, b, 0);
    expect(path).toMatch(/^M .* L /);
  });

  it("曲率があれば円弧を引き、ラベルは弧の頂点に置く", () => {
    const { path, labelY } = getFloatingEdgePath(a, b, 0.3);
    expect(path).toMatch(/ A /);
    expect(labelY).toBeGreaterThan(0);
    expect(getFloatingEdgePath(a, b, -0.3).labelY).toBeLessThan(0);
  });

  it("曲率が大きいほど弧の頂点が弦から離れる", () => {
    const gentle = getFloatingEdgePath(a, b, 0.1).labelY;
    const strong = getFloatingEdgePath(a, b, 0.4).labelY;
    expect(strong).toBeGreaterThan(gentle);
  });

  it("自己ループは指定した方角へ張り出す", () => {
    const up = getFloatingEdgePath(a, a, 0, -Math.PI / 2);
    const down = getFloatingEdgePath(a, a, 0, Math.PI / 2);
    expect(up.labelY).toBeLessThan(0);
    expect(down.labelY).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------- *
 * 曲率の最適化
 * ---------------------------------------------------------------- */

/** a→b の弧が通る両側に障害ノードがある配置（既定の矢高比だとどちらもぶつかる） */
const blockedBothSides = new Map<string, Point>([
  ["a", { x: 0, y: 0 }],
  ["b", { x: 600, y: 0 }],
  ["above", { x: 300, y: -108 }],
  ["below", { x: 300, y: 108 }],
]);
const abEdge: EdgeRef[] = [{ id: "e1", sourceNodeId: "a", targetNodeId: "b" }];

describe("chooseEdgeCurvatures", () => {
  it("同じ入力なら同じ結果（乱数を使わない）", () => {
    const first = chooseEdgeCurvatures(abEdge, blockedBothSides);
    const second = chooseEdgeCurvatures(abEdge, blockedBothSides);
    expect([...first]).toEqual([...second]);
  });

  it("既定の矢高比が両側とも塞がれていれば、曲率を変えて逃げる", () => {
    // 現行ヒューリスティックは ±0.18 の二択しかなく、どちらもノードに重なる
    const before = heuristicCurvatures(abEdge, blockedBothSides);
    const beforeOverlaps = countEdgeNodeOverlaps(
      buildEdgeGeometries(abEdge, before, blockedBothSides),
      blockedBothSides,
    );
    expect(beforeOverlaps).toBeGreaterThan(0);

    const after = chooseEdgeCurvatures(abEdge, blockedBothSides);
    expect(
      countEdgeNodeOverlaps(
        buildEdgeGeometries(abEdge, after, blockedBothSides),
        blockedBothSides,
      ),
    ).toBe(0);
    // 逃げ道は「真っ直ぐ」側（両側の障害の間を抜ける）
    expect(Math.abs(after.get("e1") ?? 1)).toBeLessThan(STRAIGHT_EPSILON);
  });

  it("避けるものが無ければ既定の矢高比を保つ（無用に真っ直ぐにしない）", () => {
    const positions = new Map<string, Point>([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 600, y: 0 }],
    ]);
    const curvature = chooseEdgeCurvatures(abEdge, positions).get("e1") ?? 0;
    expect(Math.abs(curvature)).toBeCloseTo(DEFAULT_CURVATURE, 6);
  });

  it("双方向ペアは同じ曲率（進行方向が逆なので物理的には逆側へ分かれる）", () => {
    const edges: EdgeRef[] = [
      { id: "e1", sourceNodeId: "a", targetNodeId: "b" },
      { id: "e2", sourceNodeId: "b", targetNodeId: "a" },
    ];
    const curvatures = chooseEdgeCurvatures(edges, blockedBothSides);
    expect(curvatures.get("e1")).toBe(curvatures.get("e2"));
    // 直線にすると重なるので、双方向ペアには直線を許さない
    expect(Math.abs(curvatures.get("e1") ?? 0)).toBeGreaterThan(
      STRAIGHT_EPSILON,
    );
  });

  it("両端が ring 上のエッジは重心の外側へ膨らむ", () => {
    const positions = new Map<string, Point>([
      ["a", { x: 0, y: -400 }],
      ["b", { x: 400, y: 0 }],
      ["c", { x: 0, y: 400 }],
      ["d", { x: -400, y: 0 }],
    ]);
    const edges: EdgeRef[] = [
      { id: "e1", sourceNodeId: "a", targetNodeId: "b" },
      { id: "e2", sourceNodeId: "b", targetNodeId: "c" },
      { id: "e3", sourceNodeId: "c", targetNodeId: "d" },
      { id: "e4", sourceNodeId: "d", targetNodeId: "a" },
    ];
    const ringNodeIds = new Set(["a", "b", "c", "d"]);
    const curvatures = chooseEdgeCurvatures(edges, positions, { ringNodeIds });
    for (const edge of edges) {
      const s = positions.get(edge.sourceNodeId) as Point;
      const t = positions.get(edge.targetNodeId) as Point;
      const apex = arcApex(s, t, curvatures.get(edge.id) ?? 0);
      const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
      // 重心は原点。頂点が弦の中点より外にあれば円環が外へ膨らんでいる
      expect(Math.hypot(apex.x, apex.y)).toBeGreaterThan(
        Math.hypot(mid.x, mid.y),
      );
    }
  });

  it("エッジ数が上限を超えたら最適化せず初期値を返す", () => {
    const positions = new Map<string, Point>();
    const edges: EdgeRef[] = [];
    for (let i = 0; i <= MAX_OPTIMIZED_EDGES + 1; i++) {
      positions.set(`n${i}`, {
        x: (i % 10) * 300,
        y: Math.floor(i / 10) * 300,
      });
    }
    for (let i = 0; i < MAX_OPTIMIZED_EDGES + 1; i++) {
      edges.push({
        id: `e${i}`,
        sourceNodeId: `n${i}`,
        targetNodeId: `n${i + 1}`,
      });
    }
    expect([...chooseEdgeCurvatures(edges, positions)]).toEqual([
      ...heuristicCurvatures(edges, positions),
    ]);
  });
});

describe("chooseSelfLoopAngles", () => {
  it("周りに何も無ければ既定の向き（真上）", () => {
    const positions = new Map<string, Point>([["a", { x: 0, y: 0 }]]);
    const angles = chooseSelfLoopAngles(
      [{ id: "s1", sourceNodeId: "a", targetNodeId: "a" }],
      positions,
    );
    expect(angles.get("s1")).toBe(DEFAULT_SELF_LOOP_ANGLE);
  });

  it("真上がノードで塞がっていれば別の方角を選ぶ", () => {
    const positions = new Map<string, Point>([
      ["a", { x: 0, y: 0 }],
      ["blocker", { x: 0, y: -120 }],
    ]);
    const angles = chooseSelfLoopAngles(
      [{ id: "s1", sourceNodeId: "a", targetNodeId: "a" }],
      positions,
    );
    expect(angles.get("s1")).not.toBe(DEFAULT_SELF_LOOP_ANGLE);
    // 塞がれている上方向には向かない
    expect(Math.sin(angles.get("s1") ?? 0)).toBeGreaterThan(-0.8);
  });
});

/* ---------------------------------------------------------------- *
 * 代表図でのメトリクス比較
 * ---------------------------------------------------------------- */

const mkDiagram = (
  nodeIds: string[],
  edgeSeeds: [string, string, string][],
): Diagram =>
  ({
    nodes: nodeIds.map((id) => ({ id, name: id, x: null, y: null })),
    edges: edgeSeeds.map(([id, from, to]) => ({
      id,
      sourceNodeId: from,
      targetNodeId: to,
      polarity: "+",
      hasDelay: false,
    })),
  }) as unknown as Diagram;

/** 単純ループ 5 + 弦 2 本 */
const loop5 = mkDiagram(
  ["a", "b", "c", "d", "e"],
  [
    ["e1", "a", "b"],
    ["e2", "b", "c"],
    ["e3", "c", "d"],
    ["e4", "d", "e"],
    ["e5", "e", "a"],
    ["e6", "a", "c"],
    ["e7", "b", "e"],
  ],
);

/** 二重ループ 8 */
const double8 = mkDiagram(
  ["a", "b", "c", "d", "e", "f", "g", "h"],
  [
    ["e1", "a", "b"],
    ["e2", "b", "c"],
    ["e3", "c", "d"],
    ["e4", "d", "a"],
    ["e5", "c", "e"],
    ["e6", "e", "f"],
    ["e7", "f", "g"],
    ["e8", "g", "c"],
    ["e9", "h", "a"],
    ["e10", "h", "f"],
    ["e11", "b", "g"],
  ],
);

/** ハブ & スポーク 10 */
const hub10 = mkDiagram(
  ["h", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9"],
  [
    ["e1", "h", "n1"],
    ["e2", "h", "n2"],
    ["e3", "h", "n3"],
    ["e4", "n4", "h"],
    ["e5", "n5", "h"],
    ["e6", "n6", "h"],
    ["e7", "n7", "h"],
    ["e8", "n1", "n2"],
    ["e9", "n3", "n4"],
    ["e10", "n5", "n6"],
    ["e11", "n8", "n1"],
    ["e12", "n9", "n5"],
    ["e13", "n8", "n9"],
  ],
);

/** 実際のレイアウトに掛けたうえで、最適化の前後をメトリクスで比べる */
function compare(diagram: Diagram) {
  const positions = computePositions(diagram, { reset: true });
  const edges: EdgeRef[] = diagram.edges.map((e) => ({
    id: e.id,
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
  }));
  const ringNodeIds = new Set(
    selectRingNodeIds(detectLoops(diagram.nodes, diagram.edges).loops),
  );
  const before = heuristicCurvatures(edges, positions, { ringNodeIds });
  const { curvatures, selfLoopAngles } = chooseEdgeRouting(edges, positions, {
    ringNodeIds,
  });
  const geomBefore = buildEdgeGeometries(edges, before, positions);
  const geomAfter = buildEdgeGeometries(edges, curvatures, positions, {
    selfLoopAngles,
  });
  return {
    crossings: [
      countEdgeCrossings(geomBefore, positions),
      countEdgeCrossings(geomAfter, positions),
    ] as const,
    overlaps: [
      countEdgeNodeOverlaps(geomBefore, positions),
      countEdgeNodeOverlaps(geomAfter, positions),
    ] as const,
  };
}

describe("代表図での改善", () => {
  const figures = { loop5, double8, hub10 };
  const results = Object.entries(figures).map(
    ([name, diagram]) => [name, compare(diagram)] as const,
  );

  it.each(results)("%s: 交差もノード貫通も悪化しない", (_name, result) => {
    expect(result.crossings[1]).toBeLessThanOrEqual(result.crossings[0]);
    expect(result.overlaps[1]).toBeLessThanOrEqual(result.overlaps[0]);
  });

  it("少なくとも 1 図で交差が実際に減る", () => {
    expect(results.some(([, r]) => r.crossings[1] < r.crossings[0])).toBe(true);
  });

  it("少なくとも 1 図でノード貫通が実際に減る", () => {
    expect(results.some(([, r]) => r.overlaps[1] < r.overlaps[0])).toBe(true);
  });

  it("ノード貫通は代表図すべてで解消する", () => {
    for (const [, r] of results) expect(r.overlaps[1]).toBe(0);
  });
});

describe("性能", () => {
  it("ノード 20 / エッジ 30 で 50ms 未満", () => {
    const nodeIds = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const edgeSeeds: [string, string, string][] = [];
    for (let i = 0; i < 20; i++) {
      edgeSeeds.push([`e${i}`, `n${i}`, `n${(i + 1) % 20}`]);
    }
    for (let i = 0; i < 10; i++) {
      edgeSeeds.push([`x${i}`, `n${i}`, `n${(i * 3 + 5) % 20}`]);
    }
    const diagram = mkDiagram(nodeIds, edgeSeeds);
    const positions = computePositions(diagram, { reset: true });
    const edges: EdgeRef[] = diagram.edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
    }));
    expect(edges.length).toBe(30);

    const started = performance.now();
    chooseEdgeRouting(edges, positions);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
