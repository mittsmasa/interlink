import { describe, expect, it } from "vitest";
import type { Loop } from "./loops";
import { computeDiagramMetrics, describeCandidate } from "./metrics";

function loop(partial: Partial<Loop> & Pick<Loop, "id" | "nodeIds">): Loop {
  return {
    label: "R1",
    nodeNames: partial.nodeIds,
    edgeIds: [],
    polarity: "R",
    hasDelay: false,
    ...partial,
  };
}

const nodes = [
  { id: "a", name: "残業時間" },
  { id: "b", name: "疲労" },
  { id: "c", name: "ミス" },
  { id: "d", name: "休息" },
  { id: "e", name: "孤立" },
];
// a→b→c→a（R1）、b→d→b（B1）、e は孤立
const edges = [
  { sourceNodeId: "a", targetNodeId: "b" },
  { sourceNodeId: "b", targetNodeId: "c" },
  { sourceNodeId: "c", targetNodeId: "a" },
  { sourceNodeId: "b", targetNodeId: "d" },
  { sourceNodeId: "d", targetNodeId: "b" },
];
const loops = [
  loop({ id: "loop:a→b→c", nodeIds: ["a", "b", "c"], label: "R1" }),
  loop({ id: "loop:b→d", nodeIds: ["b", "d"], label: "B1", polarity: "B" }),
];

describe("computeDiagramMetrics", () => {
  it("ノードごとに次数とループ参加数を数える", () => {
    const { nodes: m } = computeDiagramMetrics(nodes, edges, loops);
    const byId = new Map(m.map((x) => [x.nodeId, x]));
    expect(byId.get("b")).toMatchObject({
      inDegree: 2,
      outDegree: 2,
      loopCount: 2,
      reinforcingLoopCount: 1,
      balancingLoopCount: 1,
    });
    expect(byId.get("a")).toMatchObject({
      inDegree: 1,
      outDegree: 1,
      loopCount: 1,
      reinforcingLoopCount: 1,
      balancingLoopCount: 0,
    });
    expect(byId.get("e")).toMatchObject({
      inDegree: 0,
      outDegree: 0,
      loopCount: 0,
    });
  });

  it("ループ参加数 → 次数 → 名前の順に並ぶ", () => {
    const { nodes: m } = computeDiagramMetrics(nodes, edges, loops);
    expect(m[0].nodeId).toBe("b");
    expect(m.at(-1)?.nodeId).toBe("e");
  });

  it("R と B の両方に属するノードを rb-junction として返す", () => {
    const { interventionCandidates } = computeDiagramMetrics(
      nodes,
      edges,
      loops,
    );
    expect(interventionCandidates).toHaveLength(1);
    expect(interventionCandidates[0]).toMatchObject({
      nodeId: "b",
      name: "疲労",
      reason: "rb-junction",
      loopIds: ["loop:b→d", "loop:a→b→c"],
      loopLabels: ["B1", "R1"],
    });
  });

  it("同極性でも 2 ループ以上の交点は multi-loop として返し、rb-junction の後ろに置く", () => {
    const twoR = [
      loop({ id: "loop:a→b→c", nodeIds: ["a", "b", "c"], label: "R1" }),
      loop({ id: "loop:a→c", nodeIds: ["a", "c"], label: "R2" }),
      loop({ id: "loop:b→d", nodeIds: ["b", "d"], label: "B1", polarity: "B" }),
    ];
    const { interventionCandidates } = computeDiagramMetrics(
      nodes,
      edges,
      twoR,
    );
    expect(interventionCandidates.map((c) => [c.nodeId, c.reason])).toEqual([
      ["b", "rb-junction"],
      // a と c は同点（ループ 2・次数 2）なので名前順（ミス < 残業時間）
      ["c", "multi-loop"],
      ["a", "multi-loop"],
    ]);
  });

  it("ループが無ければ候補は空、指標は次数だけ入る", () => {
    const { nodes: m, interventionCandidates } = computeDiagramMetrics(
      nodes,
      edges,
      [],
    );
    expect(interventionCandidates).toEqual([]);
    expect(m.every((x) => x.loopCount === 0)).toBe(true);
  });

  it("図に無いノードを指すエッジやループは無視する", () => {
    const { nodes: m } = computeDiagramMetrics(
      nodes,
      [{ sourceNodeId: "zz", targetNodeId: "a" }],
      [loop({ id: "loop:zz", nodeIds: ["zz"] })],
    );
    expect(m.find((x) => x.nodeId === "a")?.inDegree).toBe(0);
    expect(m.every((x) => x.loopCount === 0)).toBe(true);
  });
});

describe("describeCandidate", () => {
  it("接点 / 交点の言い方を reason で変える", () => {
    expect(
      describeCandidate({
        nodeId: "b",
        name: "疲労",
        reason: "rb-junction",
        loopIds: [],
        loopLabels: ["B1", "R1"],
      }),
    ).toBe("B1 と R1 の接点");
    expect(
      describeCandidate({
        nodeId: "a",
        name: "残業時間",
        reason: "multi-loop",
        loopIds: [],
        loopLabels: ["R1", "R2"],
      }),
    ).toBe("R1・R2 の交点");
  });
});
