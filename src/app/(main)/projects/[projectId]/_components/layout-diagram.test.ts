import { describe, expect, it } from "vitest";
import type { Diagram } from "@/lib/queries/diagrams";
import { computePositions, type DerivedEdge } from "./layout-diagram";

type NodeSeed = { id: string; x?: number | null; y?: number | null };
type EdgeSeed = { id: string; from: string; to: string };

// computePositions が読むのは id / name / x / y（ノード）と
// source/target/polarity/hasDelay（エッジ）だけ。DB 行の完全型は満たさず、
// 必要なフィールドだけのモックを Diagram にキャストする。
const mkDiagram = (
  nodeSeeds: NodeSeed[],
  edgeSeeds: EdgeSeed[] = [],
): Diagram =>
  ({
    nodes: nodeSeeds.map((n) => ({
      id: n.id,
      name: `変数${n.id}`,
      x: n.x ?? null,
      y: n.y ?? null,
    })),
    edges: edgeSeeds.map((e) => ({
      id: e.id,
      sourceNodeId: e.from,
      targetNodeId: e.to,
      polarity: "+",
      hasDelay: false,
    })),
  }) as unknown as Diagram;

const distance = (
  positions: Map<string, { x: number; y: number }>,
  a: string,
  b: string,
) => {
  const p = positions.get(a);
  const q = positions.get(b);
  if (!p || !q) throw new Error(`位置が無い: ${a} / ${b}`);
  return Math.hypot(p.x - q.x, p.y - q.y);
};

describe("computePositions", () => {
  it("入力順が同じなら結果は決定的（d3-force のシード付き乱数）", () => {
    const diagram = mkDiagram(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      [
        { id: "e1", from: "a", to: "b" },
        { id: "e2", from: "b", to: "c" },
      ],
    );
    expect(computePositions(diagram)).toEqual(computePositions(diagram));
  });

  it("情報リンクを渡すと、繋がる先のノードへ引き寄せられる", () => {
    // a を遠くに固定し b は未配置。a→b の情報リンクの有無で b の寄り方を比べる。
    // リンクが無い従来は b が無関係に散る（= a から遠い）が、渡すと引き寄せられる。
    const diagram = mkDiagram([{ id: "a", x: 1000, y: 0 }, { id: "b" }]);
    const derivedEdges: DerivedEdge[] = [
      {
        id: "d1",
        sourceNodeId: "a",
        targetNodeId: "b",
        polarity: null,
        hasDelay: false,
      },
    ];
    const without = computePositions(diagram);
    const withLink = computePositions(diagram, { derivedEdges });
    expect(distance(withLink, "a", "b")).toBeLessThan(
      distance(without, "a", "b"),
    );
  });

  it("reset=true なら配置済みノードも固定せず並べ直す", () => {
    const diagram = mkDiagram(
      [
        { id: "a", x: 1000, y: 1000 },
        { id: "b", x: -1000, y: -1000 },
      ],
      [{ id: "e1", from: "a", to: "b" }],
    );
    // 通常は配置済みを fx/fy で固定するので座標は変わらない
    expect(computePositions(diagram).get("a")).toEqual({ x: 1000, y: 1000 });
    // reset では固定を無視して動かす
    expect(computePositions(diagram, { reset: true }).get("a")).not.toEqual({
      x: 1000,
      y: 1000,
    });
  });
});
