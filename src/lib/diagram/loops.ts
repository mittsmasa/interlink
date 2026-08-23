import findCircuits from "elementary-circuits-directed-graph";

/** 返すループ数の上限。超えた分は（ソート後に）切り捨てて truncated で知らせる */
export const MAX_LOOPS = 50;

/**
 * Johnson 法で列挙する circuit 数の上限。列挙順は長さ順ではないため、MAX_LOOPS ちょうどで
 * 打ち切ると「たまたま先に出た長いループ」が残り、短い重要なループが落ちる。余裕を持って
 * 列挙してからソートし MAX_LOOPS に切る。×4 は厳密にチューニングした値ではなく、
 * 密な図でも短いループを拾いやすくするための暫定係数（取りこぼしの緩和であって解決ではない）
 */
const MAX_ENUMERATED_CIRCUITS = MAX_LOOPS * 4;

export type LoopPolarity = "R" | "B" | "?";

export type Loop = {
  /** 回転正規化したノード ID 列から作る決定的な ID */
  id: string;
  /** 表示ラベル（R1, B1, ?1, …）。検出結果のソート順で極性ごとに振る */
  label: string;
  /** 一巡するノード ID 列（始点に戻る重複は含まない） */
  nodeIds: string[];
  /** nodeIds と同順の変数名 */
  nodeNames: string[];
  /** nodeIds[i] → nodeIds[(i+1) % n] にあたるエッジ ID 列 */
  edgeIds: string[];
  /**
   * R = 自己強化（負リンク偶数）、B = バランス（負リンク奇数）、
   * ? = 極性不定（式由来リンクの符号が構造から決まらない場合）
   */
  polarity: LoopPolarity;
  /** ループ内に遅れリンクを含むか */
  hasDelay: boolean;
  /**
   * 式由来（情報リンク）を 1 本でも含む暫定ループか。detectLoops は常に boolean を返す。
   * 他モジュールのテスト fixture が省略できるよう optional（未指定は「因果のみ」= false 相当）
   */
  derived?: boolean;
};

export type LoopDetectionResult = {
  loops: Loop[];
  /** MAX_LOOPS で打ち切った場合 true */
  truncated: boolean;
};

type LoopNode = { id: string; name: string };
export type LoopEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  /** null = 符号不定（式由来リンクで構造から決まらない場合） */
  polarity: "+" | "-" | null;
  hasDelay: boolean;
  /** 式由来（情報リンク）由来のエッジか。因果エッジは false/未指定 */
  derived?: boolean;
};

/** findCircuits のコールバックから検出打ち切りを伝えるための内部例外 */
class TruncationSignal extends Error {}

/** 最小のノード ID が先頭に来るよう回転する（回転同値なループの正規形） */
function rotateToMin(ids: string[]): string[] {
  let minIndex = 0;
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] < ids[minIndex]) minIndex = i;
  }
  return [...ids.slice(minIndex), ...ids.slice(0, minIndex)];
}

/**
 * 図の中のフィードバックループをすべて検出する（Johnson 法）。
 * ループは保存せず毎回ここで導出する。R/B は負リンク数の偶奇で決まる。
 */
export function detectLoops(
  nodes: LoopNode[],
  edges: LoopEdge[],
): LoopDetectionResult {
  const indexById = new Map(nodes.map((n, i) => [n.id, i]));
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));

  // ノードペアごとに最初のエッジだけ使う（多重エッジは循環構造として同値）。
  // findCircuits は自己ループを検出しないため adjacency に入れず自前で拾う
  const edgeByPair = new Map<string, LoopEdge>();
  const selfLoopEdges: LoopEdge[] = [];
  const adjacency: number[][] = nodes.map(() => []);
  for (const edge of edges) {
    const sourceIndex = indexById.get(edge.sourceNodeId);
    const targetIndex = indexById.get(edge.targetNodeId);
    if (sourceIndex === undefined || targetIndex === undefined) continue;
    const pairKey = `${edge.sourceNodeId}\u0000${edge.targetNodeId}`;
    if (edgeByPair.has(pairKey)) continue;
    edgeByPair.set(pairKey, edge);
    if (sourceIndex === targetIndex) {
      selfLoopEdges.push(edge);
    } else {
      adjacency[sourceIndex].push(targetIndex);
    }
  }

  const circuits: number[][] = [];
  let truncated = false;
  try {
    findCircuits(adjacency, (circuit) => {
      if (circuits.length >= MAX_ENUMERATED_CIRCUITS) {
        throw new TruncationSignal();
      }
      circuits.push(circuit);
    });
  } catch (error) {
    if (!(error instanceof TruncationSignal)) throw error;
    truncated = true;
  }

  // 自己ループは最短（長さ 1）なので常に先頭に積む。findCircuits の列挙に混ざらないため
  // 打ち切りの影響を受けない
  const loops: Loop[] = selfLoopEdges.map((edge) => ({
    id: `loop:${edge.sourceNodeId}`,
    label: "",
    nodeIds: [edge.sourceNodeId],
    nodeNames: [nameById.get(edge.sourceNodeId) ?? ""],
    edgeIds: [edge.id],
    polarity: edge.polarity === null ? "?" : edge.polarity === "-" ? "B" : "R",
    hasDelay: edge.hasDelay,
    derived: edge.derived === true,
  }));

  for (const circuit of circuits) {
    // findCircuits は [v0, v1, ..., v0] と始点を末尾に繰り返す
    const nodeIds = rotateToMin(
      circuit.slice(0, -1).map((index) => nodes[index].id),
    );
    const loopEdges = nodeIds.map((nodeId, i) => {
      const nextId = nodeIds[(i + 1) % nodeIds.length];
      const edge = edgeByPair.get(`${nodeId}\u0000${nextId}`);
      if (!edge) {
        throw new Error(
          `ループ内のエッジが見つかりません: ${nodeId}→${nextId}`,
        );
      }
      return edge;
    });
    // 符号不定（null）のリンクを含むループは R/B を確定できないので "?"
    const hasUnknown = loopEdges.some((e) => e.polarity === null);
    const negativeCount = loopEdges.filter((e) => e.polarity === "-").length;
    loops.push({
      id: `loop:${nodeIds.join("→")}`,
      label: "",
      nodeIds,
      nodeNames: nodeIds.map((id) => nameById.get(id) ?? ""),
      edgeIds: loopEdges.map((e) => e.id),
      polarity: hasUnknown ? "?" : negativeCount % 2 === 0 ? "R" : "B",
      hasDelay: loopEdges.some((e) => e.hasDelay),
      derived: loopEdges.some((e) => e.derived === true),
    });
  }

  // 表示が揺れないよう小さいループ優先 + ID 辞書順で安定ソートしてから上限に切り、
  // 残ったものに極性ごとの番号を振る（番号は切り捨て後に振るので欠番が出ない）
  loops.sort(
    (a, b) => a.nodeIds.length - b.nodeIds.length || a.id.localeCompare(b.id),
  );
  if (loops.length > MAX_LOOPS) {
    loops.length = MAX_LOOPS;
    truncated = true;
  }
  const counters: Record<LoopPolarity, number> = { R: 0, B: 0, "?": 0 };
  for (const loop of loops) {
    counters[loop.polarity] += 1;
    loop.label = `${loop.polarity}${counters[loop.polarity]}`;
  }

  return { loops, truncated };
}
