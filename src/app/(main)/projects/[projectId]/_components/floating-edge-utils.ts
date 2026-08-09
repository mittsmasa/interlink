import type { InternalNode } from "@xyflow/react";
import {
  arcApex,
  arcRadius,
  type Box,
  boundaryPoint,
  buildEdgeGeometry,
  type EdgeGeometry,
  type EdgeRef,
  NODE_BOX,
  type Point,
  pointInRect,
  polylineRectDistance,
  rectOf,
  rectsOverlap,
  STRAIGHT_EPSILON,
  segmentIntersection,
  segmentSegmentDistance,
  selfLoopControlPoints,
  sharesEndpoint,
} from "./edge-geometry";

/** 既定の矢高比（弦長に対する膨らみ）。最適化の出発点にも使う */
export const DEFAULT_CURVATURE = 0.18;

/** 自己ループの既定の向き（真上） */
export const DEFAULT_SELF_LOOP_ANGLE = -Math.PI / 2;

function getNodeCenter(node: InternalNode): Point {
  const { x, y } = node.internals.positionAbsolute;
  return {
    x: x + (node.measured.width ?? 0) / 2,
    y: y + (node.measured.height ?? 0) / 2,
  };
}

function getNodeBox(node: InternalNode): Box {
  return {
    width: node.measured.width ?? NODE_BOX.width,
    height: node.measured.height ?? NODE_BOX.height,
  };
}

/**
 * フローティングエッジのパスを計算する。ノード境界の交点同士を円弧で結ぶ。
 *
 * curvature は符号付きの矢高比（矢高 / 弦長）。正なら進行方向の一方へ、負なら逆へ膨らみ、
 * 絶対値が大きいほど強く曲がる。STRAIGHT_EPSILON 未満なら直線を引く。
 * 自己ループは selfLoopAngle の方角へ張り出す。
 * 返り値はパスとラベル位置（弧の頂点）。
 */
export function getFloatingEdgePath(
  sourceNode: InternalNode,
  targetNode: InternalNode,
  curvature: number = DEFAULT_CURVATURE,
  selfLoopAngle: number = DEFAULT_SELF_LOOP_ANGLE,
): { path: string; labelX: number; labelY: number } {
  const sourceCenter = getNodeCenter(sourceNode);
  const targetCenter = getNodeCenter(targetNode);

  if (sourceNode.id === targetNode.id) {
    const { start, c1, c2, end } = selfLoopControlPoints(
      sourceCenter,
      getNodeBox(sourceNode),
      selfLoopAngle,
    );
    // 3 次ベジェの t=0.5 の点
    return {
      path: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
      labelX: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
      labelY: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
    };
  }

  // 境界交点は弧の出入り方向（apex 向き）で取る
  const apexEstimate = arcApex(sourceCenter, targetCenter, curvature);
  const start = boundaryPoint(
    sourceCenter,
    getNodeBox(sourceNode),
    apexEstimate,
  );
  const end = boundaryPoint(targetCenter, getNodeBox(targetNode), apexEstimate);

  if (Math.abs(curvature) < STRAIGHT_EPSILON) {
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return {
      path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`,
      labelX: mid.x,
      labelY: mid.y,
    };
  }

  const chord = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const radius = arcRadius(chord, curvature);
  const apex = arcApex(start, end, curvature);
  const sweep = curvature > 0 ? 0 : 1;

  return {
    path: `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${sweep} ${end.x} ${end.y}`,
    labelX: apex.x,
    labelY: apex.y,
  };
}

/* ------------------------------------------------------------------ *
 * 曲率の最適化
 * ------------------------------------------------------------------ */

/** 試す矢高比。絶対値の小さい順に並べ、同点なら曲げの少ない側を採る */
const CANDIDATE_CURVATURES = [
  0, 0.1, -0.1, 0.18, -0.18, 0.28, -0.28, 0.4, -0.4,
] as const;

/** コストの重み。互いの相対比だけが意味を持つ */
const W_NODE = 100;
const W_CROSS = 60;
const W_CLOSE = 8;
const W_LABEL = 25;
const W_BEND = 22;
const W_RING = 30;
/** 自己ループを図の外向きへ寄せる弱い偏り。干渉の有無が同点のときだけ効く */
const W_SELF_OUTWARD = 8;

/**
 * 曲げの罰。基準は 0（直線）ではなく既定の矢高比。
 * 手描き寄りの弧が図の既定の佇まいなので、そこから離れるほど（真っ直ぐ過ぎても
 * 曲げ過ぎても）罰を課し、避けるべき相手がいるときだけ形を変える。
 */
function bendPenalty(curvature: number): number {
  return Math.abs(Math.abs(curvature) - DEFAULT_CURVATURE) / DEFAULT_CURVATURE;
}

/** ノードからこの距離まで近づいた弧にペナルティを課す */
const NODE_CLEARANCE = 24;
/** エッジ同士がこの距離より近い区間にペナルティを課す（並走の抑止） */
const PROXIMITY_DISTANCE = 24;
/** ラベルバッジの半径 */
const LABEL_RADIUS = 22;

/** 座標降下の最大ラウンド数 */
const MAX_ROUNDS = 4;
/** これを超えるエッジ数では最適化せず初期値を返す（描画のブロックを防ぐ） */
export const MAX_OPTIMIZED_EDGES = 60;

/** 自己ループの向きの候補。真上を先頭にし、同点なら上寄りを選ぶ */
const SELF_LOOP_ANGLE_CANDIDATES = [
  -Math.PI / 2,
  -Math.PI / 4,
  (-3 * Math.PI) / 4,
  0,
  Math.PI,
  Math.PI / 4,
  (3 * Math.PI) / 4,
  Math.PI / 2,
];

export type CurvatureOptions = {
  /** 最大フィードバックループ上のノード。両端が乗るエッジは外向きに曲げたい */
  ringNodeIds?: ReadonlySet<string>;
  /** ノード矩形の近似サイズ */
  nodeBox?: Box;
  /** 自己ループの向き（chooseSelfLoopAngles の結果） */
  selfLoopAngles?: ReadonlyMap<string, number>;
};

function centroidOf(positions: ReadonlyMap<string, Point>): Point {
  let cx = 0;
  let cy = 0;
  for (const [, p] of positions) {
    cx += p.x;
    cy += p.y;
  }
  const n = positions.size || 1;
  return { x: cx / n, y: cy / n };
}

/**
 * 現行ヒューリスティックによる初期値。
 * 両端が ring 上なら重心から外向き、それ以外は両端以外のノードから遠い側へ曲げる。
 * 座標降下はここから始めるため、最適化後の合成コストがこれを下回ることが保証される。
 */
function initialCurvature(
  edge: EdgeRef,
  positions: ReadonlyMap<string, Point>,
  ringNodeIds: ReadonlySet<string> | undefined,
  centroid: Point,
): number {
  const s = positions.get(edge.sourceNodeId);
  const t = positions.get(edge.targetNodeId);
  if (!s || !t) return DEFAULT_CURVATURE;

  const onRing =
    (ringNodeIds?.has(edge.sourceNodeId) ?? false) &&
    (ringNodeIds?.has(edge.targetNodeId) ?? false);

  let best = DEFAULT_CURVATURE;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const sign of [1, -1] as const) {
    const apex = arcApex(s, t, DEFAULT_CURVATURE * sign);
    let score: number;
    if (onRing) {
      score = Math.hypot(apex.x - centroid.x, apex.y - centroid.y);
    } else {
      let minDist = Number.POSITIVE_INFINITY;
      for (const [nodeId, pos] of positions) {
        if (nodeId === edge.sourceNodeId || nodeId === edge.targetNodeId) {
          continue;
        }
        minDist = Math.min(minDist, Math.hypot(apex.x - pos.x, apex.y - pos.y));
      }
      score = minDist === Number.POSITIVE_INFINITY ? 0 : minDist;
    }
    if (score > bestScore) {
      bestScore = score;
      best = DEFAULT_CURVATURE * sign;
    }
  }
  return best;
}

/**
 * 最適化前の曲率（現行ヒューリスティック）。自己ループは曲率を持たないので 0。
 * 座標降下の出発点であり、比較のベースラインでもある。
 */
export function heuristicCurvatures(
  edges: readonly EdgeRef[],
  positions: ReadonlyMap<string, Point>,
  options: CurvatureOptions = {},
): Map<string, number> {
  const centroid = centroidOf(positions);
  return new Map(
    edges.map((edge) => [
      edge.id,
      edge.sourceNodeId === edge.targetNodeId
        ? 0
        : initialCurvature(edge, positions, options.ringNodeIds, centroid),
    ]),
  );
}

/** 弧が「両端以外の」ノードに近づく・重なることへの罰 */
function nodePenalty(
  geom: EdgeGeometry,
  positions: ReadonlyMap<string, Point>,
  nodeBox: Box,
): number {
  let penalty = 0;
  for (const [nodeId, center] of positions) {
    if (nodeId === geom.sourceNodeId || nodeId === geom.targetNodeId) continue;
    if (!rectsOverlap(geom.bounds, rectOf(center, nodeBox, NODE_CLEARANCE))) {
      continue;
    }
    const distance = polylineRectDistance(geom.points, rectOf(center, nodeBox));
    if (distance >= NODE_CLEARANCE) continue;
    // 接近ぶんを連続的に、実際の重なりはさらに +1
    penalty += (NODE_CLEARANCE - distance) / NODE_CLEARANCE;
    if (distance === 0) penalty += 1;
  }
  return penalty;
}

/** エッジ 2 本の交差数と近接量 */
function pairPenalty(
  a: EdgeGeometry,
  b: EdgeGeometry,
  positions: ReadonlyMap<string, Point>,
  nodeBox: Box,
): { crossings: number; proximity: number } {
  if (!rectsOverlap(a.bounds, b.bounds)) return { crossings: 0, proximity: 0 };

  // 端点を共有するペアは共有ノードの周りで必ず寄り合う。その近傍は数えない
  const shared = sharesEndpoint(a, b);
  const sharedCenter = shared ? positions.get(shared) : undefined;
  const sharedRect = sharedCenter
    ? rectOf(sharedCenter, nodeBox, nodeBox.height)
    : null;

  let crossings = 0;
  let proximity = 0;
  for (let i = 0; i < a.points.length - 1; i++) {
    const p1 = a.points[i];
    const p2 = a.points[i + 1];
    const aMinX = Math.min(p1.x, p2.x);
    const aMaxX = Math.max(p1.x, p2.x);
    const aMinY = Math.min(p1.y, p2.y);
    const aMaxY = Math.max(p1.y, p2.y);
    for (let j = 0; j < b.points.length - 1; j++) {
      const q1 = b.points[j];
      const q2 = b.points[j + 1];
      // 線分単位の AABB で足切り（近接判定ぶんの余白を持たせる）
      if (
        aMinX - PROXIMITY_DISTANCE > Math.max(q1.x, q2.x) ||
        aMaxX + PROXIMITY_DISTANCE < Math.min(q1.x, q2.x) ||
        aMinY - PROXIMITY_DISTANCE > Math.max(q1.y, q2.y) ||
        aMaxY + PROXIMITY_DISTANCE < Math.min(q1.y, q2.y)
      ) {
        continue;
      }
      const hit = segmentIntersection(p1, p2, q1, q2);
      if (hit) {
        if (!sharedRect || !pointInRect(hit, sharedRect)) crossings++;
        continue;
      }
      if (shared) continue;
      const d = segmentSegmentDistance(p1, p2, q1, q2);
      if (d < PROXIMITY_DISTANCE) proximity += 1 - d / PROXIMITY_DISTANCE;
    }
  }
  return { crossings, proximity };
}

/** ラベル（弧の頂点に置くバッジ）がノードや他ラベルに被る罰 */
function labelPenalty(
  geom: EdgeGeometry,
  positions: ReadonlyMap<string, Point>,
  nodeBox: Box,
  others: readonly EdgeGeometry[],
): number {
  let penalty = 0;
  for (const [, center] of positions) {
    if (pointInRect(geom.labelPoint, rectOf(center, nodeBox, LABEL_RADIUS))) {
      penalty += 1;
    }
  }
  for (const other of others) {
    const d = Math.hypot(
      geom.labelPoint.x - other.labelPoint.x,
      geom.labelPoint.y - other.labelPoint.y,
    );
    if (d < LABEL_RADIUS * 2) penalty += 1 - d / (LABEL_RADIUS * 2);
  }
  return penalty;
}

/** ring 上のエッジが内向きに曲がる（円環が凹んで見える）ことへの罰 */
function ringPenalty(
  edge: EdgeRef,
  curvature: number,
  positions: ReadonlyMap<string, Point>,
  ringNodeIds: ReadonlySet<string> | undefined,
  centroid: Point,
): number {
  if (
    !ringNodeIds?.has(edge.sourceNodeId) ||
    !ringNodeIds.has(edge.targetNodeId)
  ) {
    return 0;
  }
  const s = positions.get(edge.sourceNodeId);
  const t = positions.get(edge.targetNodeId);
  if (!s || !t) return 0;
  const apex = arcApex(s, t, curvature);
  const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };
  const apexDist = Math.hypot(apex.x - centroid.x, apex.y - centroid.y);
  const midDist = Math.hypot(mid.x - centroid.x, mid.y - centroid.y);
  return apexDist > midDist ? 0 : 1;
}

type CostContext = {
  positions: ReadonlyMap<string, Point>;
  nodeBox: Box;
  ringNodeIds: ReadonlySet<string> | undefined;
  centroid: Point;
};

/** エッジ 1 本のコスト。others は「このエッジ以外の確定済み形状」 */
function edgeCost(
  geom: EdgeGeometry,
  curvature: number,
  others: readonly EdgeGeometry[],
  ctx: CostContext,
): number {
  let crossings = 0;
  let proximity = 0;
  for (const other of others) {
    const p = pairPenalty(geom, other, ctx.positions, ctx.nodeBox);
    crossings += p.crossings;
    proximity += p.proximity;
  }
  return (
    W_NODE * nodePenalty(geom, ctx.positions, ctx.nodeBox) +
    W_CROSS * crossings +
    W_CLOSE * proximity +
    W_LABEL * labelPenalty(geom, ctx.positions, ctx.nodeBox, others) +
    W_BEND * bendPenalty(curvature) +
    W_RING *
      ringPenalty(geom, curvature, ctx.positions, ctx.ringNodeIds, ctx.centroid)
  );
}

/** 自己ループが図の内側を向いている度合い（外向き 0 〜 内向き 1）。同点の解きほぐしに使う */
function inwardness(nodeId: string, angle: number, ctx: CostContext): number {
  const center = ctx.positions.get(nodeId);
  if (!center) return 0;
  const dx = center.x - ctx.centroid.x;
  const dy = center.y - ctx.centroid.y;
  // 重心そのものに乗っているノードには外向きが定義できない
  if (Math.hypot(dx, dy) < 1) return 0;
  return (1 - Math.cos(angle - Math.atan2(dy, dx))) / 2;
}

/**
 * 自己ループの向きを決める。8 方角のうち、他ノード・他エッジと最も干渉しない方角を選ぶ。
 * context には自己ループ以外のエッジ形状（初期曲率のもの）を渡す。
 * 同点なら候補順（真上 → 斜め上 → 横 → 下）で先に来る方角を採るため決定的。
 */
export function chooseSelfLoopAngles(
  edges: readonly EdgeRef[],
  positions: ReadonlyMap<string, Point>,
  context: readonly EdgeGeometry[] = [],
  options: CurvatureOptions = {},
): Map<string, number> {
  const nodeBox = options.nodeBox ?? NODE_BOX;
  const ctx: CostContext = {
    positions,
    nodeBox,
    ringNodeIds: options.ringNodeIds,
    centroid: centroidOf(positions),
  };
  const selfLoops = edges
    .filter((e) => e.sourceNodeId === e.targetNodeId)
    .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const angles = new Map<string, number>();
  const decided: EdgeGeometry[] = [...context];

  for (const edge of selfLoops) {
    let bestAngle = DEFAULT_SELF_LOOP_ANGLE;
    let bestGeom: EdgeGeometry | null = null;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const angle of SELF_LOOP_ANGLE_CANDIDATES) {
      const geom = buildEdgeGeometry(edge, 0, positions, {
        nodeBox,
        selfLoopAngles: new Map([[edge.id, angle]]),
      });
      if (!geom) continue;
      const cost =
        edgeCost(geom, 0, decided, ctx) +
        W_SELF_OUTWARD * inwardness(edge.sourceNodeId, angle, ctx);
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        bestAngle = angle;
        bestGeom = geom;
      }
    }
    angles.set(edge.id, bestAngle);
    if (bestGeom) decided.push(bestGeom);
  }
  return angles;
}

/**
 * 自己ループの向きと通常エッジの曲率をまとめて決める。図全体の描画はこれ 1 本で足りる。
 *
 * 自己ループを先に確定してから曲率を最適化する。逆順にすると、自己ループだけが
 * 通常エッジを避けられ、通常エッジは未確定の自己ループを避けられない非対称が生じる。
 * 自己ループ側の判断材料には、通常エッジの初期曲率での形を渡す。
 */
export function chooseEdgeRouting(
  edges: readonly EdgeRef[],
  positions: ReadonlyMap<string, Point>,
  options: CurvatureOptions = {},
): { curvatures: Map<string, number>; selfLoopAngles: Map<string, number> } {
  const nodeBox = options.nodeBox ?? NODE_BOX;
  const initial = heuristicCurvatures(edges, positions, options);
  const context: EdgeGeometry[] = [];
  for (const edge of edges) {
    if (edge.sourceNodeId === edge.targetNodeId) continue;
    const geom = buildEdgeGeometry(edge, initial.get(edge.id) ?? 0, positions, {
      nodeBox,
    });
    if (geom) context.push(geom);
  }
  const selfLoopAngles = chooseSelfLoopAngles(edges, positions, context, {
    ...options,
    nodeBox,
  });
  const curvatures = chooseEdgeCurvatures(edges, positions, {
    ...options,
    nodeBox,
    selfLoopAngles,
  });
  return { curvatures, selfLoopAngles };
}

/** 双方向ペアをひとつの変数にまとめた最適化の単位 */
type CurvatureVariable = {
  edges: EdgeRef[];
  candidates: readonly number[];
};

function buildVariables(edges: readonly EdgeRef[]): CurvatureVariable[] {
  const byKey = new Map<string, EdgeRef[]>();
  for (const edge of edges) {
    // 向きを問わないノード対をキーにして双方向ペアを束ねる
    const key =
      edge.sourceNodeId < edge.targetNodeId
        ? `${edge.sourceNodeId} ${edge.targetNodeId}`
        : `${edge.targetNodeId} ${edge.sourceNodeId}`;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(edge);
    else byKey.set(key, [edge]);
  }
  return [...byKey.values()].map((group) => ({
    edges: group.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    // 同じノード対に複数本あるときは直線だと重なるので 0 を外す
    candidates:
      group.length > 1
        ? CANDIDATE_CURVATURES.filter((c) => c !== 0)
        : CANDIDATE_CURVATURES,
  }));
}

/**
 * 各エッジの曲率（符号付き矢高比）を決める。
 *
 * 弧全体をポリラインで近似し「無関係なノードへの侵入 / エッジ同士の交差 / 並走 /
 * ラベル衝突 / 曲げすぎ / ring の内向き」の重み付き和を、座標降下で下げる。
 * 初期値は現行ヒューリスティック（ring 外向き・ノード回避）で、降下は改善時しか
 * 値を動かさないため、合成コストは初期値以下に収まる。乱数は使わず決定的。
 *
 * 自己ループは曲率を持たない（向きは chooseSelfLoopAngles が決める）が、
 * 他エッジが避けるべき形状としてコストに参入する。返り値では 0 を入れる。
 */
export function chooseEdgeCurvatures(
  edges: readonly EdgeRef[],
  positions: ReadonlyMap<string, Point>,
  options: CurvatureOptions = {},
): Map<string, number> {
  const nodeBox = options.nodeBox ?? NODE_BOX;
  const centroid = centroidOf(positions);
  const ctx: CostContext = {
    positions,
    nodeBox,
    ringNodeIds: options.ringNodeIds,
    centroid,
  };

  const curvatures = heuristicCurvatures(edges, positions, options);
  if (edges.length > MAX_OPTIMIZED_EDGES) return curvatures;

  const geomOptions = { nodeBox, selfLoopAngles: options.selfLoopAngles };
  const geometries = new Map<string, EdgeGeometry>();
  for (const edge of edges) {
    const geom = buildEdgeGeometry(
      edge,
      curvatures.get(edge.id) ?? 0,
      positions,
      geomOptions,
    );
    if (geom) geometries.set(edge.id, geom);
  }

  const variables = buildVariables(
    edges.filter(
      (e) => e.sourceNodeId !== e.targetNodeId && geometries.has(e.id),
    ),
  ).toSorted((a, b) => (a.edges[0].id < b.edges[0].id ? -1 : 1));

  /** 変数に value を入れたときのコスト（変数内のエッジ同士の相互作用も 1 回だけ数える） */
  const variableCost = (variable: CurvatureVariable, value: number) => {
    const own = variable.edges
      .map((e) => buildEdgeGeometry(e, value, positions, geomOptions))
      .filter((g): g is EdgeGeometry => g !== null);
    const ownIds = new Set(variable.edges.map((e) => e.id));
    const others = [...geometries.values()].filter((g) => !ownIds.has(g.id));

    let cost = 0;
    for (const geom of own) cost += edgeCost(geom, value, others, ctx);
    for (let i = 0; i < own.length; i++) {
      for (let j = i + 1; j < own.length; j++) {
        const p = pairPenalty(own[i], own[j], positions, nodeBox);
        cost += W_CROSS * p.crossings + W_CLOSE * p.proximity;
      }
    }
    return { cost, geometries: own };
  };

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const variable of variables) {
      const current = curvatures.get(variable.edges[0].id) ?? 0;
      let best = variableCost(variable, current);
      let bestValue = current;
      for (const candidate of variable.candidates) {
        if (candidate === current) continue;
        const trial = variableCost(variable, candidate);
        if (trial.cost < best.cost - 1e-9) {
          best = trial;
          bestValue = candidate;
        }
      }
      if (bestValue !== current) {
        for (const edge of variable.edges) curvatures.set(edge.id, bestValue);
        for (const geom of best.geometries) geometries.set(geom.id, geom);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return curvatures;
}
