/**
 * エッジ（円弧）とノード（矩形）の幾何計算。ReactFlow に依存しない純関数だけを置く。
 *
 * 描画（floating-edge-utils の getFloatingEdgePath）とコスト評価（chooseEdgeCurvatures）が
 * 同じ弧を見るよう、弧の定義（矢高比 → 半径 → 円弧）はこのモジュールに集約する。
 *
 * 座標系: positions はノード「中心」として扱う。computePositions の出力は ReactFlow 上では
 * 左上座標だが、全ノードに同じ矩形サイズを仮定する限り一様な平行移動でしかなく、
 * 交差数・距離といった相対的な量は変わらないためそのまま渡してよい。
 */

export type Point = { x: number; y: number };
export type Box = { width: number; height: number };
export type Rect = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * ノード矩形の近似サイズ。variable-node は max-w-40(160px) + px-4 + border で
 * 最大 192px 幅、高さは kind バッジ / 単位の有無で 40〜72px。
 * レイアウト計算時点では ReactFlow の measured が無いため定数で近似する（安全側に大きめ）。
 */
export const NODE_BOX: Box = { width: 192, height: 64 };

/** これ未満の曲率は直線として扱う */
export const STRAIGHT_EPSILON = 0.02;

/** 弧をポリライン近似するときのサンプル点数（両端を含む） */
export const ARC_SAMPLE_COUNT = 9;

/** 自己ループの弧が中心から張り出す距離 */
export const SELF_LOOP_REACH = 96;

/** 自己ループの出入り口を、向きベクトルから左右へ開く角度 */
const SELF_LOOP_SPREAD = 0.42;

export function rectOf(center: Point, box: Box, pad = 0): Rect {
  const halfW = box.width / 2 + pad;
  const halfH = box.height / 2 + pad;
  return {
    minX: center.x - halfW,
    minY: center.y - halfH,
    maxX: center.x + halfW,
    maxY: center.y + halfH,
  };
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return (
    a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
  );
}

export function boundsOf(points: readonly Point[], pad = 0): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX: minX - pad,
    minY: minY - pad,
    maxX: maxX + pad,
    maxY: maxY + pad,
  };
}

/** 中心 → toward 方向とノード矩形の境界の交点 */
export function boundaryPoint(center: Point, box: Box, toward: Point): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scaleX =
    dx !== 0 ? box.width / 2 / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY =
    dy !== 0 ? box.height / 2 / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/**
 * 弦 start→end に対し、符号付き矢高比 curvature の円弧が通る頂点（apex）。
 * 正の curvature は進行方向の左手側（SVG 座標なので画面上では右手側）へ膨らむ。
 */
export function arcApex(start: Point, end: Point, curvature: number): Point {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  if (chord === 0) return mid;
  const sagitta = chord * curvature;
  return {
    x: mid.x + (-dy / chord) * sagitta,
    y: mid.y + (dx / chord) * sagitta,
  };
}

/** 弦と矢高比から円弧の半径を出す（r = c²/8h + h/2） */
export function arcRadius(chord: number, curvature: number): number {
  const sagitta = chord * Math.abs(curvature);
  return chord ** 2 / (8 * sagitta) + sagitta / 2;
}

/**
 * 円弧を等角度でサンプルした点列。曲率が閾値未満なら直線を等分する。
 * 描画される SVG 円弧（半径 = arcRadius、劣弧）と同じ曲線を辿る。
 */
export function arcSamples(
  start: Point,
  end: Point,
  curvature: number,
  count = ARC_SAMPLE_COUNT,
): Point[] {
  const steps = Math.max(2, count) - 1;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);

  if (chord === 0) return [start, end];
  if (Math.abs(curvature) < STRAIGHT_EPSILON) {
    return Array.from({ length: steps + 1 }, (_, i) => ({
      x: start.x + (dx * i) / steps,
      y: start.y + (dy * i) / steps,
    }));
  }

  const apex = arcApex(start, end, curvature);
  const radius = arcRadius(chord, curvature);
  // 円の中心は apex から弦の中点向きへ半径ぶん戻った位置
  const towardMid = {
    x: (start.x + end.x) / 2 - apex.x,
    y: (start.y + end.y) / 2 - apex.y,
  };
  const towardLen = Math.hypot(towardMid.x, towardMid.y) || 1;
  const center = {
    x: apex.x + (towardMid.x / towardLen) * radius,
    y: apex.y + (towardMid.y / towardLen) * radius,
  };

  const a0 = Math.atan2(start.y - center.y, start.x - center.x);
  const a1 = Math.atan2(end.y - center.y, end.x - center.x);
  // 矢高比 0.4 でも中心角は 180° 未満なので、劣弧（|Δ| ≤ π）が描かれる弧に一致する
  let delta = a1 - a0;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  return Array.from({ length: steps + 1 }, (_, i) => {
    // 端点は丸め誤差を持ち込まず元の値をそのまま使う
    if (i === 0) return start;
    if (i === steps) return end;
    const a = a0 + (delta * i) / steps;
    return {
      x: center.x + Math.cos(a) * radius,
      y: center.y + Math.sin(a) * radius,
    };
  });
}

/** 自己ループの出入り口方向（角度 angle の左右へ SELF_LOOP_SPREAD だけ開く） */
function selfLoopDirections(angle: number) {
  return {
    exit: {
      x: Math.cos(angle + SELF_LOOP_SPREAD),
      y: Math.sin(angle + SELF_LOOP_SPREAD),
    },
    entry: {
      x: Math.cos(angle - SELF_LOOP_SPREAD),
      y: Math.sin(angle - SELF_LOOP_SPREAD),
    },
  };
}

/** 自己ループの制御点。描画（3 次ベジェ）とサンプルで共有する */
export function selfLoopControlPoints(
  center: Point,
  box: Box,
  angle: number,
): { start: Point; c1: Point; c2: Point; end: Point } {
  const { exit, entry } = selfLoopDirections(angle);
  const far = 1000;
  const start = boundaryPoint(center, box, {
    x: center.x + exit.x * far,
    y: center.y + exit.y * far,
  });
  const end = boundaryPoint(center, box, {
    x: center.x + entry.x * far,
    y: center.y + entry.y * far,
  });
  return {
    start,
    c1: {
      x: start.x + exit.x * SELF_LOOP_REACH,
      y: start.y + exit.y * SELF_LOOP_REACH,
    },
    c2: {
      x: end.x + entry.x * SELF_LOOP_REACH,
      y: end.y + entry.y * SELF_LOOP_REACH,
    },
    end,
  };
}

/** 自己ループ（3 次ベジェ）のサンプル点列 */
export function selfLoopSamples(
  center: Point,
  box: Box,
  angle: number,
  count = ARC_SAMPLE_COUNT,
): Point[] {
  const { start, c1, c2, end } = selfLoopControlPoints(center, box, angle);
  const steps = Math.max(2, count) - 1;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return {
      x:
        u ** 3 * start.x +
        3 * u ** 2 * t * c1.x +
        3 * u * t ** 2 * c2.x +
        t ** 3 * end.x,
      y:
        u ** 3 * start.y +
        3 * u ** 2 * t * c1.y +
        3 * u * t ** 2 * c2.y +
        t ** 3 * end.y,
    };
  });
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * 線分同士の交点。交わらなければ null。
 *
 * 端点で接する場合も交点として返す。ポリライン近似では交差点がちょうど
 * サンプル頂点に乗ることがあり、そこを除外すると交差を取りこぼすため。
 * 共線（重なって走る）は交点を一意に決められないので null（近接コストの側で拾う）。
 */
export function segmentIntersection(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): Point | null {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  if (d1 === 0 && d2 === 0) return null;
  if (d1 * d2 > 0 || d3 * d4 > 0) return null;
  const t = d1 / (d1 - d2);
  return { x: a1.x + (a2.x - a1.x) * t, y: a1.y + (a2.y - a1.y) * t };
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** 線分同士の最短距離（交差していれば 0） */
export function segmentSegmentDistance(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): number {
  if (segmentIntersection(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

export function pointInRect(p: Point, rect: Rect): boolean {
  return (
    p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY
  );
}

/** 線分と矩形の最短距離（矩形に触れていれば 0） */
export function segmentRectDistance(p1: Point, p2: Point, rect: Rect): number {
  if (pointInRect(p1, rect) || pointInRect(p2, rect)) return 0;
  const corners: Point[] = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.maxX, y: rect.maxY },
    { x: rect.minX, y: rect.maxY },
  ];
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 4; i++) {
    const d = segmentSegmentDistance(p1, p2, corners[i], corners[(i + 1) % 4]);
    if (d < min) min = d;
    if (min === 0) return 0;
  }
  return min;
}

/** ポリライン（弧の近似）と矩形の最短距離 */
export function polylineRectDistance(points: readonly Point[], rect: Rect) {
  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length - 1; i++) {
    const d = segmentRectDistance(points[i], points[i + 1], rect);
    if (d < min) min = d;
    if (min === 0) return 0;
  }
  return min;
}

export type EdgeRef = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
};

/** 曲率を決めたあとのエッジ形状。コスト評価とメトリクスで共有する */
export type EdgeGeometry = EdgeRef & {
  points: Point[];
  bounds: Rect;
  /** ラベルを置く位置（弧のほぼ頂点） */
  labelPoint: Point;
};

export type GeometryOptions = {
  nodeBox?: Box;
  /** 自己ループの向き（ラジアン）。未指定は真上 */
  selfLoopAngles?: ReadonlyMap<string, number>;
  sampleCount?: number;
};

/**
 * エッジ 1 本の形状を作る。両端の位置が取れない場合は null。
 * 弧の端点はノード矩形の境界で切る（描画と同じ扱い）。
 */
export function buildEdgeGeometry(
  edge: EdgeRef,
  curvature: number,
  positions: ReadonlyMap<string, Point>,
  options: GeometryOptions = {},
): EdgeGeometry | null {
  const {
    nodeBox = NODE_BOX,
    selfLoopAngles,
    sampleCount = ARC_SAMPLE_COUNT,
  } = options;
  const source = positions.get(edge.sourceNodeId);
  const target = positions.get(edge.targetNodeId);
  if (!source || !target) return null;

  if (edge.sourceNodeId === edge.targetNodeId) {
    const angle = selfLoopAngles?.get(edge.id) ?? -Math.PI / 2;
    const points = selfLoopSamples(source, nodeBox, angle, sampleCount);
    return {
      ...edge,
      points,
      bounds: boundsOf(points),
      labelPoint: points[Math.floor(points.length / 2)],
    };
  }

  const apexEstimate = arcApex(source, target, curvature);
  const start = boundaryPoint(source, nodeBox, apexEstimate);
  const end = boundaryPoint(target, nodeBox, apexEstimate);
  const points = arcSamples(start, end, curvature, sampleCount);
  return {
    ...edge,
    points,
    bounds: boundsOf(points),
    labelPoint: arcApex(start, end, curvature),
  };
}

/** 全エッジの形状をまとめて作る（曲率が無いエッジは 0 = 直線） */
export function buildEdgeGeometries(
  edges: readonly EdgeRef[],
  curvatures: ReadonlyMap<string, number>,
  positions: ReadonlyMap<string, Point>,
  options: GeometryOptions = {},
): EdgeGeometry[] {
  const result: EdgeGeometry[] = [];
  for (const edge of edges) {
    const geom = buildEdgeGeometry(
      edge,
      curvatures.get(edge.id) ?? 0,
      positions,
      options,
    );
    if (geom) result.push(geom);
  }
  return result;
}

/** 2 本のエッジが端点（ノード）を共有しているか */
export function sharesEndpoint(a: EdgeRef, b: EdgeRef): string | null {
  if (a.sourceNodeId === b.sourceNodeId || a.sourceNodeId === b.targetNodeId) {
    return a.sourceNodeId;
  }
  if (a.targetNodeId === b.sourceNodeId || a.targetNodeId === b.targetNodeId) {
    return a.targetNodeId;
  }
  return null;
}

/**
 * 2 本のエッジの交差回数。端点を共有するペアは、共有ノードの近傍で必ず寄り合うため
 * その付近（ノード矩形を少し広げた範囲）の交点は数えない。
 */
export function countCrossingsBetween(
  a: EdgeGeometry,
  b: EdgeGeometry,
  positions: ReadonlyMap<string, Point>,
  nodeBox: Box = NODE_BOX,
): number {
  if (!rectsOverlap(a.bounds, b.bounds)) return 0;
  const shared = sharesEndpoint(a, b);
  const sharedRect = shared
    ? (() => {
        const center = positions.get(shared);
        return center ? rectOf(center, nodeBox, nodeBox.height) : null;
      })()
    : null;

  let count = 0;
  for (let i = 0; i < a.points.length - 1; i++) {
    for (let j = 0; j < b.points.length - 1; j++) {
      const hit = segmentIntersection(
        a.points[i],
        a.points[i + 1],
        b.points[j],
        b.points[j + 1],
      );
      if (!hit) continue;
      if (sharedRect && pointInRect(hit, sharedRect)) continue;
      count++;
    }
  }
  return count;
}

/** 交差しているエッジのペア数（同じペアは 1 と数える） */
export function countEdgeCrossings(
  geometries: readonly EdgeGeometry[],
  positions: ReadonlyMap<string, Point>,
  nodeBox: Box = NODE_BOX,
): number {
  let pairs = 0;
  for (let i = 0; i < geometries.length; i++) {
    for (let j = i + 1; j < geometries.length; j++) {
      if (
        countCrossingsBetween(
          geometries[i],
          geometries[j],
          positions,
          nodeBox,
        ) > 0
      ) {
        pairs++;
      }
    }
  }
  return pairs;
}

/**
 * 弧が「両端以外の」ノード矩形に重なっている（エッジ, ノード）の組数。
 * clearance を渡すと、その距離まで近づいた時点で重なり扱いにできる。
 */
export function countEdgeNodeOverlaps(
  geometries: readonly EdgeGeometry[],
  positions: ReadonlyMap<string, Point>,
  nodeBox: Box = NODE_BOX,
  clearance = 0,
): number {
  let count = 0;
  for (const geom of geometries) {
    for (const [nodeId, center] of positions) {
      if (nodeId === geom.sourceNodeId || nodeId === geom.targetNodeId)
        continue;
      const rect = rectOf(center, nodeBox, clearance);
      if (!rectsOverlap(geom.bounds, rect)) continue;
      if (polylineRectDistance(geom.points, rect) === 0) count++;
    }
  }
  return count;
}
