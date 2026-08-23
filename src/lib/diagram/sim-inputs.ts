import type { SimEdge, SimNode, SimNodeKind } from "./simulate";

/**
 * 図のノード行のうち、シミュレーション入力に要る field だけの構造的型。
 * DB 行（queries/diagrams の DiagramNode）も loadDiagramSnapshot の行もこれを満たす。
 */
export type SimSourceNode = {
  id: string;
  name: string;
  kind: SimNodeKind | null;
  expression: string | null;
  initialValue: number | null;
  value: number | null;
};

export type SimSourceEdge = {
  sourceNodeId: string;
  targetNodeId: string;
  polarity: "+" | "-";
};

/**
 * 図のノードからシミュレーション入力（SimNode）へ写す。
 * kind 未設定（null = CLD のまま）のノードは数値的意味を持たないので除外する。
 * 名前は simulate 側で ASCII プレースホルダへ内部変換されるため、日本語名のまま渡してよい。
 */
export function toSimNodes(nodes: SimSourceNode[]): SimNode[] {
  const result: SimNode[] = [];
  for (const node of nodes) {
    if (node.kind === null) continue;
    result.push({
      id: node.id,
      name: node.name,
      kind: node.kind,
      expression: node.expression,
      initialValue: node.initialValue,
      value: node.value,
    });
  }
  return result;
}

/**
 * 図のエッジを SimEdge へ写す。polarity は schema 上 "+"/"-" で SimEdge とそのまま一致する。
 * simulate 側は flow → stock のエッジだけを流入/流出として解釈するため、ここでは全エッジを
 * 素直に渡してよい（関係ないエッジは simulate 内で無視される。lint の SFD 整合ルールが
 * 無視されるエッジを事前に warning として出す）。
 */
export function toSimEdges(edges: SimSourceEdge[]): SimEdge[] {
  return edges.map((edge) => ({
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    polarity: edge.polarity,
  }));
}
