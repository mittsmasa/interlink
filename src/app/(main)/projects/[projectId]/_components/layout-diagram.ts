import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import type { Diagram } from "@/lib/queries/diagrams";

type SimNode = SimulationNodeDatum & { id: string };

/**
 * 未配置（x, y が null）のノードを d3-force で配置する。
 * 配置済みノードは fx/fy で固定し、新しいノードだけが既存の構造の
 * まわりに収まる。入力順が同じなら結果は決定的。
 */
export function computePositions(diagram: Diagram) {
  const simNodes: SimNode[] = diagram.nodes.map((n) =>
    n.x != null && n.y != null
      ? { id: n.id, x: n.x, y: n.y, fx: n.x, fy: n.y }
      : { id: n.id },
  );
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
    .stop();

  simulation.tick(200);

  return new Map(simNodes.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}
