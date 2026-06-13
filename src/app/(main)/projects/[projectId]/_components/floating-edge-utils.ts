import type { InternalNode } from "@xyflow/react";

type Point = { x: number; y: number };

/** 弧の膨らみ側。+1 = 進行方向に対して sweep=0 側、-1 = その逆 */
export type BulgeSign = 1 | -1;

/** 矢高（膨らみ）は弦長に対するこの比率。大きいほど強く曲がる */
const SAGITTA_RATIO = 0.18;

function getNodeCenter(node: InternalNode): Point {
  const { x, y } = node.internals.positionAbsolute;
  return {
    x: x + (node.measured.width ?? 0) / 2,
    y: y + (node.measured.height ?? 0) / 2,
  };
}

/** ノード矩形の境界と「中心 → toward」方向の交点 */
function getRectIntersection(node: InternalNode, toward: Point): Point {
  const center = getNodeCenter(node);
  const halfW = (node.measured.width ?? 0) / 2;
  const halfH = (node.measured.height ?? 0) / 2;
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scaleX = dx !== 0 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY;
  const scaleY = dy !== 0 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY;
  const scale = Math.min(scaleX, scaleY);
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/**
 * フローティングエッジのパスを計算する。
 * ノード境界の交点同士を円弧（矢高 = 弦長の 30%）で結ぶ。
 * bulgeSign で膨らむ側を選ぶ（chooseBulgeSign で決定的に決める）。
 * 返り値はパスとラベル位置（弧の頂点）。
 */
export function getFloatingEdgePath(
  sourceNode: InternalNode,
  targetNode: InternalNode,
  bulgeSign: BulgeSign = 1,
): { path: string; labelX: number; labelY: number } {
  const sourceCenter = getNodeCenter(sourceNode);
  const targetCenter = getNodeCenter(targetNode);

  // 自己ループ: 上辺から出て上で弧を描いて戻る
  if (sourceNode.id === targetNode.id) {
    const top = sourceNode.internals.positionAbsolute.y;
    const w = sourceNode.measured.width ?? 0;
    const sx = sourceCenter.x + w / 4;
    const tx = sourceCenter.x - w / 4;
    const peakY = top - 70;
    return {
      path: `M ${sx} ${top} C ${sx + 50} ${peakY}, ${tx - 50} ${peakY}, ${tx} ${top}`,
      labelX: sourceCenter.x,
      labelY: peakY + 14,
    };
  }

  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const dist = Math.hypot(dx, dy) || 1;
  const normX = (-dy / dist) * bulgeSign;
  const normY = (dx / dist) * bulgeSign;

  // 円弧の頂点（apex）: 弦の中点から法線方向に矢高ぶん張り出した点。
  // 半径 r との関係は r = c²/8h + h/2
  const apexEstimate = {
    x: (sourceCenter.x + targetCenter.x) / 2 + normX * dist * SAGITTA_RATIO,
    y: (sourceCenter.y + targetCenter.y) / 2 + normY * dist * SAGITTA_RATIO,
  };

  // 境界交点は弧の出入り方向（apex 向き）で取る
  const start = getRectIntersection(sourceNode, apexEstimate);
  const end = getRectIntersection(targetNode, apexEstimate);

  // 交点間の弦で矢高と半径を確定し、円弧で結ぶ
  const chordX = end.x - start.x;
  const chordY = end.y - start.y;
  const chord = Math.hypot(chordX, chordY) || 1;
  const sagitta = chord * SAGITTA_RATIO;
  const radius = chord ** 2 / (8 * sagitta) + sagitta / 2;
  const apex = {
    x: (start.x + end.x) / 2 + (-chordY / chord) * sagitta * bulgeSign,
    y: (start.y + end.y) / 2 + (chordX / chord) * sagitta * bulgeSign,
  };
  const sweep = bulgeSign === 1 ? 0 : 1;

  return {
    path: `M ${start.x} ${start.y} A ${radius} ${radius} 0 0 ${sweep} ${end.x} ${end.y}`,
    labelX: apex.x,
    labelY: apex.y,
  };
}

type EdgeRef = { id: string; sourceNodeId: string; targetNodeId: string };

/**
 * 各エッジの膨らみ側を決定的に選ぶ。
 * - 双方向ペア（A→B と B→A）は互いに逆側へ逃がして重なりを防ぐ
 * - それ以外は、膨らみ候補（法線 ±）のうち両端以外のノードから遠い側を選ぶ
 *   （ループの内側にノードがあれば外側に開く）
 * 座標はレイアウト計算後のもの（ドラッグ中のライブ座標ではない）で良い。
 */
export function chooseBulgeSigns(
  edges: EdgeRef[],
  positions: Map<string, Point>,
): Map<string, BulgeSign> {
  const result = new Map<string, BulgeSign>();

  for (const edge of edges) {
    if (edge.sourceNodeId === edge.targetNodeId) {
      result.set(edge.id, 1);
      continue;
    }

    // 双方向ペア: 進行方向基準の法線が互いに逆を向くため、
    // 同符号にすれば物理的には逆側へ分かれて輪になる
    const hasReverse = edges.some(
      (e) =>
        e.id !== edge.id &&
        e.sourceNodeId === edge.targetNodeId &&
        e.targetNodeId === edge.sourceNodeId,
    );
    if (hasReverse) {
      result.set(edge.id, 1);
      continue;
    }

    const s = positions.get(edge.sourceNodeId);
    const t = positions.get(edge.targetNodeId);
    if (!s || !t) {
      result.set(edge.id, 1);
      continue;
    }
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const dist = Math.hypot(dx, dy) || 1;
    const sag = dist * SAGITTA_RATIO;
    const mid = { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 };

    let best: BulgeSign = 1;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const sign of [1, -1] as const) {
      const apex = {
        x: mid.x + (-dy / dist) * sag * sign,
        y: mid.y + (dx / dist) * sag * sign,
      };
      let minDist = Number.POSITIVE_INFINITY;
      for (const [nodeId, pos] of positions) {
        if (nodeId === edge.sourceNodeId || nodeId === edge.targetNodeId) {
          continue;
        }
        minDist = Math.min(minDist, Math.hypot(apex.x - pos.x, apex.y - pos.y));
      }
      // 他ノードがなければ既定の側
      const score = minDist === Number.POSITIVE_INFINITY ? 0 : minDist;
      if (score > bestScore) {
        bestScore = score;
        best = sign;
      }
    }
    result.set(edge.id, best);
  }

  return result;
}
