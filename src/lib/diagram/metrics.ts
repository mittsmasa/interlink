import type { Loop } from "./loops";

/** get_diagram / パネルに載せる介入候補の上限 */
export const MAX_INTERVENTION_CANDIDATES = 5;
/** get_diagram に載せるノード指標の上限（ループ参加数・次数の上位） */
export const MAX_METRIC_NODES = 5;

export type NodeMetrics = {
  nodeId: string;
  name: string;
  inDegree: number;
  outDegree: number;
  /** 参加しているループ数（極性 ? も含む） */
  loopCount: number;
  reinforcingLoopCount: number;
  balancingLoopCount: number;
};

/**
 * 介入候補の根拠。
 * rb-junction = R と B の両方に属する（強化を止める／抑制を外す両方の手がかり）、
 * multi-loop = 同じ極性でも 2 つ以上のループが交差する
 */
export type InterventionReason = "rb-junction" | "multi-loop";

export type InterventionCandidate = {
  nodeId: string;
  name: string;
  reason: InterventionReason;
  /** 交差しているループ（ラベル順） */
  loopIds: string[];
  loopLabels: string[];
};

export type DiagramMetrics = {
  /** 全ノード分。ループ参加数 → 次数 → 名前 の順で降順に整列済み */
  nodes: NodeMetrics[];
  /** 介入候補。rb-junction を先に、次にループ数・次数の多い順 */
  interventionCandidates: InterventionCandidate[];
};

type MetricsNode = { id: string; name: string };
type MetricsEdge = { sourceNodeId: string; targetNodeId: string };

/** ループ内ノード数 → 次数 → 名前 で安定ソート */
function compareByInfluence(a: NodeMetrics, b: NodeMetrics) {
  return (
    b.loopCount - a.loopCount ||
    b.inDegree + b.outDegree - (a.inDegree + a.outDegree) ||
    a.name.localeCompare(b.name, "ja")
  );
}

/**
 * ノードごとの構造指標と介入候補を導出する。保存せず毎回計算する。
 * edges は buildLoopEdges の結果（因果 + 式由来）を渡す想定。ループに含まれない
 * ノードは candidates に出ない。
 */
export function computeDiagramMetrics(
  nodes: readonly MetricsNode[],
  edges: readonly MetricsEdge[],
  loops: readonly Loop[],
): DiagramMetrics {
  const metricsById = new Map<string, NodeMetrics>(
    nodes.map((n) => [
      n.id,
      {
        nodeId: n.id,
        name: n.name,
        inDegree: 0,
        outDegree: 0,
        loopCount: 0,
        reinforcingLoopCount: 0,
        balancingLoopCount: 0,
      },
    ]),
  );

  for (const edge of edges) {
    const source = metricsById.get(edge.sourceNodeId);
    const target = metricsById.get(edge.targetNodeId);
    if (!source || !target) continue;
    source.outDegree += 1;
    target.inDegree += 1;
  }

  const loopsByNode = new Map<string, Loop[]>();
  for (const loop of loops) {
    // 同じノードが 1 ループに 2 回現れることはない（単純閉路）が、念のため重複を除く
    for (const nodeId of new Set(loop.nodeIds)) {
      const m = metricsById.get(nodeId);
      if (!m) continue;
      m.loopCount += 1;
      if (loop.polarity === "R") m.reinforcingLoopCount += 1;
      if (loop.polarity === "B") m.balancingLoopCount += 1;
      const list = loopsByNode.get(nodeId);
      if (list) list.push(loop);
      else loopsByNode.set(nodeId, [loop]);
    }
  }

  const sorted = [...metricsById.values()].sort(compareByInfluence);

  const candidates: InterventionCandidate[] = [];
  for (const m of sorted) {
    const isJunction = m.reinforcingLoopCount >= 1 && m.balancingLoopCount >= 1;
    const isMulti = m.loopCount >= 2;
    if (!isJunction && !isMulti) continue;
    const nodeLoops = [...(loopsByNode.get(m.nodeId) ?? [])].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
    candidates.push({
      nodeId: m.nodeId,
      name: m.name,
      reason: isJunction ? "rb-junction" : "multi-loop",
      loopIds: nodeLoops.map((l) => l.id),
      loopLabels: nodeLoops.map((l) => l.label),
    });
  }
  // R/B 接点を先に。sorted 由来なので同 reason 内は影響度順のまま
  candidates.sort(
    (a, b) =>
      Number(b.reason === "rb-junction") - Number(a.reason === "rb-junction"),
  );

  return { nodes: sorted, interventionCandidates: candidates };
}

/** 介入候補の一言説明（agenda / パネル共通）。例: 「R1 と B1 の接点」「R1・R2 の交点」 */
export function describeCandidate(candidate: InterventionCandidate): string {
  if (candidate.reason === "rb-junction") {
    return `${candidate.loopLabels.join(" と ")} の接点`;
  }
  return `${candidate.loopLabels.join("・")} の交点`;
}
