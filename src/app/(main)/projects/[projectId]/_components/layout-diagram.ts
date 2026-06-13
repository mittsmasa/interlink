import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import { detectLoops } from "@/lib/diagram/loops";
import type { Diagram } from "@/lib/queries/diagrams";

type SimNode = SimulationNodeDatum & { id: string };

/**
 * 未配置（x, y が null）のノードを d3-force で配置する。
 * 配置済みノードは fx/fy で固定し、新しいノードだけが既存の構造の
 * まわりに収まる。入力順が同じなら結果は決定的。
 *
 * 最大のフィードバックループはループ順に円周へ初期配置し、forceRadial で
 * 円を保つ。円環が円として描かれることでエッジの交差が減る。
 */
export function computePositions(diagram: Diagram) {
  const { loops } = detectLoops(diagram.nodes, diagram.edges);
  // detectLoops はノード数昇順で返すため末尾が最大ループ
  const largest = loops.at(-1);
  const ringIds = largest && largest.nodeIds.length >= 3 ? largest.nodeIds : [];
  // 隣接ノードの間隔がおおむね link distance になる半径
  const ringRadius = Math.max(220, (ringIds.length * 280) / (2 * Math.PI));
  const ringSeeds = new Map(
    ringIds.map((id, i) => {
      const angle = (i / ringIds.length) * 2 * Math.PI - Math.PI / 2;
      return [
        id,
        { x: Math.cos(angle) * ringRadius, y: Math.sin(angle) * ringRadius },
      ];
    }),
  );

  // リングに属さないノードは、リング上の接続先の外側へ seed する
  // （forceX/Y に引かれて円の内側へ割り込むのを防ぐ）
  const outerSeed = (nodeId: string) => {
    for (const e of diagram.edges) {
      const other =
        e.sourceNodeId === nodeId
          ? e.targetNodeId
          : e.targetNodeId === nodeId
            ? e.sourceNodeId
            : null;
      const anchor = other ? ringSeeds.get(other) : undefined;
      if (anchor) {
        const scale = (ringRadius + 280) / ringRadius;
        return { x: anchor.x * scale, y: anchor.y * scale };
      }
    }
    return undefined;
  };

  const simNodes: SimNode[] = diagram.nodes.map((n) => {
    if (n.x != null && n.y != null) {
      return { id: n.id, x: n.x, y: n.y, fx: n.x, fy: n.y };
    }
    const seed = ringSeeds.get(n.id) ?? outerSeed(n.id);
    return seed ? { id: n.id, x: seed.x, y: seed.y } : { id: n.id };
  });
  const links = diagram.edges
    // 自己ループはレイアウトに影響させない
    .filter((e) => e.sourceNodeId !== e.targetNodeId)
    .map((e) => ({ source: e.sourceNodeId, target: e.targetNodeId }));

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink(links)
        .id((d) => (d as SimNode).id)
        .distance(280)
        .strength(0.4),
    )
    .force("charge", forceManyBody().strength(-900))
    .force("collide", forceCollide(110))
    .force("x", forceX(0).strength(0.04))
    .force("y", forceY(0).strength(0.04))
    .force(
      "ring",
      // リングメンバーは円周に強めに保持、それ以外はゆるく外周へ
      // （リングがない図では無効）
      forceRadial(
        (d) =>
          ringSeeds.has((d as SimNode).id) ? ringRadius : ringRadius + 280,
        0,
        0,
      ).strength((d) => {
        if (ringIds.length === 0) return 0;
        return ringSeeds.has((d as SimNode).id) ? 0.6 : 0.08;
      }),
    )
    .stop();

  simulation.tick(200);

  return new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}
