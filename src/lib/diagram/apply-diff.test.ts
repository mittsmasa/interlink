import { describe, expect, it } from "vitest";
import {
  type CurrentDiagram,
  normalizeName,
  planDiagramMutation,
  suggestNodeNames,
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

describe("suggestNodeNames", () => {
  it("部分一致を最優先し、編集距離の近い順に最大 3 件返す", () => {
    expect(
      suggestNodeNames("残業", ["残業時間", "残高", "疲労", "業務量"]),
    ).toEqual(["残業時間", "残高"]);
  });

  it("同名（正規化後一致）と遠い名前は返さない", () => {
    expect(suggestNodeNames("疲労", ["疲労", "顧客満足度"])).toEqual([]);
  });

  it("全角半角・大文字小文字のゆれを越えて照合する", () => {
    expect(suggestNodeNames("ｋｐｉ達成", ["KPI達成率", "売上"])).toEqual([
      "KPI達成率",
    ]);
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

  it("新規エッジの status は省略時 inferred、指定時はその値になる", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertEdges: [
          {
            source: "疲労",
            target: "残業時間",
            polarity: "+",
            rationale: "推測",
          },
          {
            source: "残業時間",
            target: "残業時間",
            polarity: "+",
            rationale: "本人談",
            status: "confirmed",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.createEdges.map((e) => e.status)).toEqual([
      "inferred",
      "confirmed",
    ]);
  });

  it("既存エッジの更新で status を省略すると現状維持（キーを持たない）", () => {
    const base = {
      source: "残業時間",
      target: "疲労",
      polarity: "+" as const,
      rationale: "見直し",
    };
    const omitted = planDiagramMutation(diagram, diff({ upsertEdges: [base] }));
    expect(omitted.ok && omitted.plan.updateEdges[0]).not.toHaveProperty(
      "status",
    );
    const given = planDiagramMutation(
      diagram,
      diff({ upsertEdges: [{ ...base, status: "disputed" }] }),
    );
    expect(given.ok && given.plan.updateEdges[0]).toMatchObject({
      status: "disputed",
    });
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
    expect(result.plan.warnings[0]).toMatchObject({
      code: "unresolved-edge",
      target: "存在しない変数→生産性",
    });
    expect(result.plan.warnings[0].message).toContain("存在しない変数");
  });

  it("unresolved-edge の warning には近い既存変数名が suggestion として付く", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        upsertEdges: [
          { source: "残業", target: "疲労", polarity: "+", rationale: "x" },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 有効操作ゼロでも warnings は構造のまま返る
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "unresolved-edge",
        target: "残業→疲労",
        suggestion: ["残業時間"],
      }),
    ]);
    expect(result.reason).toContain("残業→疲労");
  });

  it("同一 diff で作る新規ノードも suggestion の候補になる", () => {
    const result = planDiagramMutation(
      emptyDiagram,
      diff({
        upsertNodes: [{ name: "生産性" }],
        upsertEdges: [
          { source: "生産", target: "生産性", polarity: "+", rationale: "x" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.warnings[0]).toMatchObject({
      code: "unresolved-edge",
      suggestion: ["生産性"],
    });
  });

  it("削除対象が無い変数にも suggestion が付く", () => {
    const result = planDiagramMutation(
      diagram,
      diff({ upsertNodes: [{ name: "x" }], deleteNodes: ["疲れ"] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.warnings[0]).toMatchObject({
      code: "missing-node",
      target: "疲れ",
      suggestion: ["疲労"],
    });
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

describe("planDiagramMutation（改名）", () => {
  /** 式を持つ図。疲労 は auxiliary で 残業時間 を参照している */
  const sfdDiagram: CurrentDiagram = {
    nodes: [
      { id: "n1", name: "残業時間", expression: null },
      { id: "n2", name: "疲労", expression: "残業時間 * 0.5" },
    ],
    edges: [{ id: "e1", sourceNodeId: "n1", targetNodeId: "n2" }],
  };

  it("改名は name だけの updateNodes になり、エッジ操作を伴わない", () => {
    const result = planDiagramMutation(
      diagram,
      diff({ renameNodes: [{ from: "残業時間", to: "労働時間" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes).toEqual([{ id: "n1", name: "労働時間" }]);
    expect(result.plan.deleteNodeIds).toHaveLength(0);
    expect(result.plan.createNodes).toHaveLength(0);
    expect(result.plan.deleteEdgeIds).toHaveLength(0);
    expect(result.plan.warnings).toHaveLength(0);
  });

  it("改名後の名前で同一 diff のリンク追加・変数更新が解決される", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        renameNodes: [{ from: "残業時間", to: "労働時間" }],
        upsertNodes: [{ name: "労働時間", memo: "週あたり" }],
        upsertEdges: [
          {
            source: "疲労",
            target: "労働時間",
            polarity: "+",
            rationale: "疲れると効率が落ちて時間が伸びる",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes).toEqual([
      { id: "n1", memo: "週あたり", unit: undefined, name: "労働時間" },
    ]);
    expect(result.plan.createNodes).toHaveLength(0);
    expect(result.plan.createEdges).toEqual([
      expect.objectContaining({ sourceName: "疲労", targetName: "労働時間" }),
    ]);
    expect(result.plan.warnings).toHaveLength(0);
  });

  it("改名後の名前で既存リンクを送ると新規作成ではなく更新になる", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        renameNodes: [{ from: "残業時間", to: "労働時間" }],
        upsertEdges: [
          {
            source: "労働時間",
            target: "疲労",
            polarity: "-",
            rationale: "見直し",
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.createEdges).toHaveLength(0);
    expect(result.plan.updateEdges[0]).toMatchObject({ id: "e1" });
  });

  it("改名元が無ければその改名だけ無視して warning にする", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        renameNodes: [
          { from: "残業", to: "労働時間" },
          { from: "疲労", to: "疲労感" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes).toEqual([{ id: "n2", name: "疲労感" }]);
    expect(result.plan.warnings).toEqual([
      expect.objectContaining({
        code: "rename-missing",
        target: "残業→労働時間",
        suggestion: ["残業時間"],
      }),
    ]);
  });

  it("改名先が既存の変数と正規化一致したら改名しない", () => {
    const result = planDiagramMutation(
      diagram,
      diff({ renameNodes: [{ from: "残業時間", to: " 疲労 " }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "rename-conflict",
        target: "残業時間→ 疲労 ",
      }),
    ]);
  });

  it("表記ゆれの直しは自分自身との衝突にしない", () => {
    const result = planDiagramMutation(
      diagram,
      diff({ renameNodes: [{ from: "残業時間", to: "残業時間 " }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes).toEqual([{ id: "n1", name: "残業時間 " }]);
  });

  it("同じ diff で消す変数の名前へは衝突扱いせず改名できる", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        renameNodes: [{ from: "残業時間", to: "疲労" }],
        deleteNodes: ["疲労"],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.deleteNodeIds).toEqual(["n2"]);
    expect(result.plan.updateNodes).toEqual([{ id: "n1", name: "疲労" }]);
    expect(result.plan.warnings).toHaveLength(0);
  });

  it("削除が無視される名前へは改名させない（同名が 2 つ残らない）", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        renameNodes: [{ from: "残業時間", to: "疲労" }],
        deleteNodes: ["疲労"],
        upsertNodes: [{ name: "疲労", memo: "残す" }],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.deleteNodeIds).toHaveLength(0);
    expect(result.plan.updateNodes).toEqual([
      { id: "n2", memo: "残す", unit: undefined },
    ]);
    expect(result.plan.warnings.map((w) => w.code)).toEqual([
      "rename-conflict",
      "delete-conflict",
    ]);
  });

  it("改名した変数を同じ diff で削除する指定は無視する", () => {
    const result = planDiagramMutation(
      diagram,
      diff({
        renameNodes: [{ from: "残業時間", to: "労働時間" }],
        deleteNodes: ["残業時間"],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.deleteNodeIds).toHaveLength(0);
    expect(result.plan.warnings).toEqual([
      expect.objectContaining({ code: "delete-conflict", target: "残業時間" }),
    ]);
  });

  it("他の変数の式にある参照も新しい名前へ置き換える", () => {
    const result = planDiagramMutation(
      sfdDiagram,
      diff({ renameNodes: [{ from: "残業時間", to: "労働時間" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes).toEqual([
      { id: "n1", name: "労働時間" },
      { id: "n2", expression: "労働時間 * 0.5" },
    ]);
    expect(result.plan.warnings).toHaveLength(0);
  });

  it("連鎖する改名でも式の参照は最後の名前まで追いつく", () => {
    const result = planDiagramMutation(
      sfdDiagram,
      diff({
        renameNodes: [
          { from: "残業時間", to: "労働時間" },
          { from: "労働時間", to: "稼働時間" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes).toEqual([
      { id: "n1", name: "稼働時間" },
      { id: "n2", expression: "稼働時間 * 0.5" },
    ]);
  });

  it("同じ diff で式を送り直したら改名の追従では上書きしない", () => {
    const result = planDiagramMutation(
      sfdDiagram,
      diff({
        renameNodes: [{ from: "残業時間", to: "労働時間" }],
        upsertNodes: [
          { name: "疲労", kind: "auxiliary", expression: "労働時間 * 0.8" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes.find((n) => n.id === "n2")).toMatchObject({
      expression: "労働時間 * 0.8",
    });
  });

  it("式で参照できない名前への改名では式を書き換えず warning にする", () => {
    const result = planDiagramMutation(
      sfdDiagram,
      diff({ renameNodes: [{ from: "残業時間", to: "労働 時間" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes).toEqual([{ id: "n1", name: "労働 時間" }]);
    expect(result.plan.warnings).toEqual([
      expect.objectContaining({ code: "rename-expression", target: "疲労" }),
    ]);
  });

  it("式が無効なら改名を反映せず warning にする", () => {
    const result = planDiagramMutation(
      {
        ...sfdDiagram,
        nodes: [
          { id: "n1", name: "残業時間", expression: null },
          { id: "n2", name: "疲労", expression: "sqrt(残業時間)" },
        ],
      },
      diff({ renameNodes: [{ from: "残業時間", to: "労働時間" }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.updateNodes).toEqual([{ id: "n1", name: "労働時間" }]);
    expect(result.plan.warnings).toEqual([
      expect.objectContaining({
        code: "rename-expression",
        target: "疲労",
        message: expect.stringContaining("式が無効"),
      }),
    ]);
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
    expect(result.plan.warnings).toEqual([
      expect.objectContaining({
        code: "invalid-expression",
        target: "疲労",
        message: expect.stringContaining("式が無効"),
      }),
    ]);
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
    if (result.ok) return;
    expect(result.warnings[0]).toMatchObject({
      code: "kind-missing",
      target: "疲労",
    });
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
