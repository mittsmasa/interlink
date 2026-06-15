import type { SimEdge, SimNode } from "@/lib/diagram/simulate";
import type { DiagramEdge, DiagramNode } from "@/lib/queries/diagrams";

/**
 * 図のノードからシミュレーション入力（SimNode）へ写す。
 * kind 未設定（null = CLD のまま）のノードは数値的意味を持たないので除外する。
 * 名前は simulate 側で ASCII プレースホルダへ内部変換されるため、日本語名のまま渡してよい。
 */
export function toSimNodes(nodes: DiagramNode[]): SimNode[] {
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
 * 素直に渡してよい（関係ないエッジは simulate 内で無視される）。
 */
export function toSimEdges(edges: DiagramEdge[]): SimEdge[] {
  return edges.map((edge) => ({
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
    polarity: edge.polarity,
  }));
}

/**
 * 実行ボタンの出し分け用の軽い判定。stock が 1 つも無ければシミュレーションは成立しない
 * （時間発展する量が無い）。厳密な妥当性（式の参照解決・循環・missing-field 等）は
 * simulate に委ね、ここでは「押せる状態かどうか」だけを大まかに見る。
 */
export function canSimulate(simNodes: SimNode[]): boolean {
  return simNodes.some((node) => node.kind === "stock");
}
