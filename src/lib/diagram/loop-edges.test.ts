import { describe, expect, it } from "vitest";
import {
  buildLoopEdges,
  deriveLoopDependencies,
  toDerivedLoopEdges,
} from "./loop-edges";
import { detectLoops } from "./loops";

const node = (id: string, name: string, expression: string | null = null) => ({
  id,
  name,
  expression,
});
const edge = (
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  polarity: "+" | "-" = "+",
) => ({ id, sourceNodeId, targetNodeId, polarity, hasDelay: false });

describe("deriveLoopDependencies", () => {
  it("式由来の依存のうち同方向の因果エッジが無いものだけ返す", () => {
    const diagram = {
      nodes: [
        node("balance", "残高"),
        node("rate", "金利"),
        node("interest", "利息", "残高*金利"),
      ],
      // 残高→利息 は因果エッジとして既にあるので除外、金利→利息 だけ残る
      edges: [edge("e1", "balance", "interest")],
    };
    const deps = deriveLoopDependencies(diagram);
    expect(deps.map((d) => [d.fromNodeId, d.toNodeId, d.polarity])).toEqual([
      ["rate", "interest", "+"],
    ]);
  });
});

describe("toDerivedLoopEdges", () => {
  it("依存を derived エッジに正規化する（極性 null も保持）", () => {
    const edges = toDerivedLoopEdges([
      { id: "dep:a->b", fromNodeId: "a", toNodeId: "b", polarity: null },
    ]);
    expect(edges).toEqual([
      {
        id: "dep:a->b",
        sourceNodeId: "a",
        targetNodeId: "b",
        polarity: null,
        hasDelay: false,
        derived: true,
      },
    ]);
  });
});

describe("buildLoopEdges", () => {
  it("因果エッジの後ろに派生エッジを並べる", () => {
    const diagram = {
      nodes: [node("balance", "残高"), node("interest", "利息", "残高*0.1")],
      edges: [edge("e1", "interest", "balance")],
    };
    const edges = buildLoopEdges(diagram);
    expect(edges.map((e) => e.id)).toEqual(["e1", "dep:balance->interest"]);
    expect(edges[1].derived).toBe(true);
  });

  it("因果エッジだけでは閉じない円環を式由来リンク込みで暫定ループとして拾う", () => {
    const diagram = {
      nodes: [node("balance", "残高"), node("interest", "利息", "残高*0.1")],
      edges: [edge("e1", "interest", "balance")],
    };
    const causalOnly = detectLoops(diagram.nodes, diagram.edges);
    expect(causalOnly.loops).toHaveLength(0);
    const withDerived = detectLoops(diagram.nodes, buildLoopEdges(diagram));
    expect(withDerived.loops).toHaveLength(1);
    expect(withDerived.loops[0]).toMatchObject({
      polarity: "R",
      derived: true,
    });
  });

  it("式が無ければ因果エッジそのまま", () => {
    const diagram = {
      nodes: [node("a", "甲"), node("b", "乙")],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "a")],
    };
    expect(buildLoopEdges(diagram)).toEqual(diagram.edges);
  });
});
