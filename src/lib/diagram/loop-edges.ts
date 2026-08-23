import { isCausallyLinked } from "./dependencies";
import {
  deriveSignedDependencies,
  type SignedDependency,
} from "./dependency-polarity";
import type { LoopEdge } from "./loops";

type LoopEdgeNode = {
  id: string;
  name: string;
  expression?: string | null;
};

type CausalEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  polarity: "+" | "-";
  hasDelay: boolean;
};

export type LoopEdgeDiagram = {
  nodes: LoopEdgeNode[];
  edges: CausalEdge[];
};

/** 式由来リンクをループ検出用に正規化したエッジ。`derived: true` で因果エッジと区別する */
export type DerivedLoopEdge = LoopEdge & { derived: true };

/**
 * 式の依存（情報リンク）のうち、同方向の因果エッジが図に無いもの。
 * キャンバスの破線描画とループ参加の両方でこの同一集合を使い、「破線 ⟺ ループ参加リンク」を
 * 一致させる（保存せず毎回導出）。
 */
export function deriveLoopDependencies(
  diagram: LoopEdgeDiagram,
): SignedDependency[] {
  return deriveSignedDependencies(diagram.nodes).filter(
    (dep) => !isCausallyLinked(dep.fromNodeId, dep.toNodeId, diagram.edges),
  );
}

/** 情報リンクを detectLoops / computePositions が受け取る派生エッジ形に正規化する */
export function toDerivedLoopEdges(
  dependencies: SignedDependency[],
): DerivedLoopEdge[] {
  return dependencies.map((dep) => ({
    id: dep.id,
    sourceNodeId: dep.fromNodeId,
    targetNodeId: dep.toNodeId,
    polarity: dep.polarity,
    hasDelay: false,
    derived: true,
  }));
}

/**
 * ループ検出に渡すエッジ集合（因果エッジ + 式由来の派生エッジ）を組み立てる。
 * キャンバス / チャット / MCP が同じ集合で detectLoops を呼ぶための唯一の入口。
 * ここを経由しない呼び出しは式で閉じる暫定ループを見落とし、UI と AI の見る構造がずれる
 */
export function buildLoopEdges(diagram: LoopEdgeDiagram): LoopEdge[] {
  return [
    ...diagram.edges,
    ...toDerivedLoopEdges(deriveLoopDependencies(diagram)),
  ];
}
