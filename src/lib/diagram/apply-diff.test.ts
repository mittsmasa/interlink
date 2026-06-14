import { describe, expect, it } from "vitest";
import {
  type CurrentDiagram,
  normalizeName,
  planDiagramMutation,
} from "./apply-diff";
import { diagramDiffSchema } from "./diff-schema";

const emptyDiagram: CurrentDiagram = { nodes: [], edges: [] };

const diagram: CurrentDiagram = {
  nodes: [
    { id: "n1", name: "残業時間" },
    { id: "n2", name: "疲労" },
  ],
  edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
};

/** zod の default を通した diff を作るヘルパ */
function diff(input: unknown) {
  return diagramDiffSchema.parse(input);
}

describe("normalizeName", () => {
  it("前後空白・全角半角・大文字小文字のゆれを吸収する", () => {
    expect(normalizeName(" 残業時間 ")).toBe(normalizeName("残業時間"));
    expect(normalizeName("ＫＰＩ")).toBe(normalizeName("kpi"));
  });
});

describe("planDiagramMutation", () => {
  it("新規ノードと新規エッジを同一 diff で計画できる", () => {
    const result = planDiagramMutation(
      emptyDiagram,
      diff({
        upsertNodes: [{ name: "残業時間" }, { name: "疲労" }],
        upsertEdges: [
          {
            source: "残業時間",
            target: "疲労",
            polarity: "+",
            rationale: "残業が続くと疲れが溜まると発言",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.createNodes).toHaveLength(2);
    expect(result.plan.createEdges).toHaveLength(1);
    expect(result.plan.warnings).toHaveLength(0);
  });

  it("既存と同名のノードは作成せず更新になる", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertNodes: [{ name: " 残業時間 ", memo: "週あたりの残業" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.createNodes).toHaveLength(0);
    expect(result.plan.updateNodes).toEqual([
      { id: "n1", memo: "週あたりの残業", unit: undefined },
    ]);
  });

  it("既存の source→target ペアへの upsertEdges は更新になる", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertEdges: [
          {
            source: "残業時間",
            target: "疲労",
            polarity: "-",
            hasDelay: true,
            rationale: "見直し",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.createEdges).toHaveLength(0);
    expect(result.plan.updateEdges).toEqual([
      { id: "e1", polarity: "-", hasDelay: true, rationale: "見直し" },
    ]);
  });

  it("参照先のない変数へのエッジは除外され warning になる", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertNodes: [{ name: "生産性" }],
        upsertEdges: [
          {
            source: "存在しない変数",
            target: "生産性",
            polarity: "+",
            rationale: "x",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.createEdges).toHaveLength(0);
    expect(result.plan.warnings).toHaveLength(1);
  });

  it("削除予定の変数へ張るエッジは除外される", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertNodes: [{ name: "生産性" }],
        deleteNodes: ["疲労"],
        upsertEdges: [
          { source: "生産性", target: "疲労", polarity: "-", rationale: "x" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.deleteNodeIds).toEqual(["n2"]);
    expect(result.plan.createEdges).toHaveLength(0);
    expect(result.plan.warnings.length).toBeGreaterThan(0);
  });

  it("自己ループ（自分自身への因果）は許容する", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertEdges: [
          {
            source: "疲労",
            target: "疲労",
            polarity: "+",
            rationale: "疲労が回復力を下げてさらに疲労が溜まる",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.createEdges).toHaveLength(1);
  });

  it("空 diff は拒否する", () => {
    const result = planDiagramMutation(diagram, diff({}));
    expect(result.ok).toBe(false);
  });

  it("無効操作だけの diff は拒否する", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        deleteNodes: ["存在しない変数"],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("図の全変数を削除する diff は拒否する", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        deleteNodes: ["残業時間", "疲労"],
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("全削除しても新規追加で図が残るなら受け付ける", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertNodes: [{ name: "業務量" }],
        deleteNodes: ["残業時間", "疲労"],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("追加と削除が同名で衝突したら削除を無視する", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertNodes: [{ name: "残業時間", memo: "更新" }],
        deleteNodes: ["残業時間"],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.deleteNodeIds).toHaveLength(0);
    expect(result.plan.updateNodes).toHaveLength(1);
  });
});

describe("planDiagramMutation（SFD 化）", () => {
  it("新規ノードに kind:stock と initialValue を付けると createNodes に載る", () => {
    const result = planDiagramMutation(
      emptyDiagram,
      diff({
        upsertNodes: [{ name: "残高", kind: "stock", initialValue: 100 }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.createNodes[0]).toMatchObject({
      name: "残高",
      kind: "stock",
      initialValue: 100,
      expression: null,
      value: null,
    });
  });

  it("既存ノードへ kind だけ指定すると memo/unit 無しでも updateNodes に載る", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertNodes: [{ name: "疲労", kind: "stock", initialValue: 30 }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes[0]).toMatchObject({
      id: "n2",
      kind: "stock",
      initialValue: 30,
      expression: null,
      value: null,
    });
  });

  it("flow に正しい式を渡すと expression が載る", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertNodes: [{ name: "疲労", kind: "flow", expression: "残高 * 0.1" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes[0]).toMatchObject({
      id: "n2",
      kind: "flow",
      expression: "残高 * 0.1",
      initialValue: null,
      value: null,
    });
  });

  it("flow に関数を含む不正な式を渡すと式は載らず warning になる", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertNodes: [{ name: "疲労", kind: "flow", expression: "sqrt(x)" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes[0]).toMatchObject({
      kind: "flow",
      expression: null,
    });
    expect(result.plan.warnings.some((w) => w.includes("式が無効"))).toBe(true);
  });

  it("kind 別に無関係な列は正規化で null 化される", () => {
    const result = planDiagramMutation(
      emptyDiagram,
      diff({
        upsertNodes: [
          {
            name: "残高",
            kind: "stock",
            expression: "a + b",
            initialValue: 5,
            value: 9,
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.createNodes[0]).toMatchObject({
      kind: "stock",
      initialValue: 5,
      expression: null,
      value: null,
    });
  });

  it("kind 指定なしで式だけ来たら無視し warning にする", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertNodes: [{ name: "疲労", expression: "残高 * 2" }],
      }),
    );
    // 有効操作が無いので拒否（式は無視され、memo/unit/kind もない）
    expect(result.ok).toBe(false);
  });

  it("kind:null で未分類へ戻すと 3 列とも null になる", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertNodes: [{ name: "疲労", kind: null }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes[0]).toMatchObject({
      id: "n2",
      kind: null,
      expression: null,
      initialValue: null,
      value: null,
    });
  });
});
