import { describe, expect, it } from "vitest";
import {
  type SimEdge,
  type SimNode,
  simulate,
  validateExpressionStructure,
} from "./simulate";

const stock = (id: string, name: string, initialValue: number): SimNode => ({
  id,
  name,
  kind: "stock",
  initialValue,
});
const flow = (id: string, name: string, expression: string): SimNode => ({
  id,
  name,
  kind: "flow",
  expression,
});
const aux = (id: string, name: string, expression: string): SimNode => ({
  id,
  name,
  kind: "auxiliary",
  expression,
});
const constant = (id: string, name: string, value: number): SimNode => ({
  id,
  name,
  kind: "constant",
  value,
});
const edge = (
  sourceNodeId: string,
  targetNodeId: string,
  polarity: "+" | "-" = "+",
): SimEdge => ({ sourceNodeId, targetNodeId, polarity });

/** 設計ノート 7 章の悪循環モデル（疲労 → ミス率 → 残業時間 → 残業増 → 疲労） */
function fatigueModel() {
  const nodes: SimNode[] = [
    stock("fatigue", "疲労", 30),
    aux("missRate", "ミス率", "疲労/100"),
    aux("overtime", "残業時間", "8 + ミス率*20"),
    flow("overtimeUp", "残業増", "残業時間*0.5"),
    flow("recovery", "回復", "疲労*0.1"),
  ];
  const edges: SimEdge[] = [
    edge("overtimeUp", "fatigue", "+"),
    edge("recovery", "fatigue", "-"),
  ];
  return { nodes, edges };
}

describe("simulate", () => {
  it("設計ノートの計算例どおり疲労が 30→34→38→42 と推移する", () => {
    const { nodes, edges } = fatigueModel();
    const result = simulate(nodes, edges, { dt: 1, steps: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fatigue = result.series.map((s) => s.疲労);
    expect(fatigue[0]).toBeCloseTo(30, 6);
    expect(fatigue[1]).toBeCloseTo(34, 6);
    expect(fatigue[2]).toBeCloseTo(38, 6);
    expect(fatigue[3]).toBeCloseTo(42, 6);
    // t=0 のスナップショットは開始時点の stock + そこから計算した flow/aux
    expect(result.series[0].ミス率).toBeCloseTo(0.3, 6);
    expect(result.series[0].残業時間).toBeCloseTo(14, 6);
    expect(result.series[0].残業増).toBeCloseTo(7, 6);
    expect(result.series[0].回復).toBeCloseTo(3, 6);
    expect(result.series).toHaveLength(4);
  });

  it("stock がループを断ち切るので CLD 上の循環があっても計算できる", () => {
    // 疲労 → ミス率 → … → 残業増 → 疲労 は CLD では円環だが、
    // 経路が stock(疲労) を通るため flow/aux の依存は非循環で計算できる
    const { nodes, edges } = fatigueModel();
    const result = simulate(nodes, edges, { dt: 0.5, steps: 2 });
    expect(result.ok).toBe(true);
  });

  it("flow/auxiliary 同士の循環は cycle エラー", () => {
    const nodes: SimNode[] = [
      aux("a", "甲", "乙 + 1"),
      aux("b", "乙", "甲 + 1"),
    ];
    const result = simulate(nodes, [], { dt: 1, steps: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("cycle");
    expect(result.error.nodeIds).toEqual(expect.arrayContaining(["a", "b"]));
  });

  it("自己参照する auxiliary も cycle として検出する", () => {
    const result = simulate([aux("a", "甲", "甲 + 1")], [], {
      dt: 1,
      steps: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("cycle");
  });

  it("関数呼び出しは disallowed で弾く（四則演算と参照のみ）", () => {
    const nodes: SimNode[] = [stock("s", "量", 4), aux("a", "甲", "sqrt(量)")];
    const result = simulate(nodes, [], { dt: 1, steps: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("disallowed");
    expect(result.error.nodeId).toBe("a");
  });

  it("べき乗など四則演算以外の演算子も disallowed", () => {
    const result = simulate([aux("a", "甲", "2 ^ 3")], [], {
      dt: 1,
      steps: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("disallowed");
  });

  it("未定義の変数参照は undefined-reference", () => {
    const result = simulate([aux("a", "甲", "存在しない + 1")], [], {
      dt: 1,
      steps: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("undefined-reference");
    expect(result.error.refName).toBe("存在しない");
  });

  it("構文エラーの式は parse エラー", () => {
    const result = simulate([aux("a", "甲", "1 + + *")], [], {
      dt: 1,
      steps: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("parse");
  });

  it("stock に initialValue がなければ missing-field", () => {
    const result = simulate([{ id: "s", name: "量", kind: "stock" }], [], {
      dt: 1,
      steps: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("missing-field");
    expect(result.error.nodeId).toBe("s");
  });

  it("flow に expression がなければ missing-field", () => {
    const result = simulate([{ id: "f", name: "流", kind: "flow" }], [], {
      dt: 1,
      steps: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("missing-field");
  });

  it("名前の重複は duplicate-name", () => {
    const result = simulate([stock("s1", "量", 1), stock("s2", "量", 2)], [], {
      dt: 1,
      steps: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("duplicate-name");
  });

  it("式で参照できない名前は invalid-identifier", () => {
    const result = simulate([stock("s", "量 と 単位", 1)], [], {
      dt: 1,
      steps: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("invalid-identifier");
  });

  it("dt が 0 以下なら invalid-config", () => {
    const result = simulate([stock("s", "量", 1)], [], { dt: 0, steps: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("invalid-config");
  });

  it("steps が 1 未満なら invalid-config", () => {
    const result = simulate([stock("s", "量", 1)], [], { dt: 1, steps: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("invalid-config");
  });

  it("constant を式から参照でき、値はステップ間で一定", () => {
    const nodes: SimNode[] = [
      stock("s", "残高", 100),
      constant("r", "金利", 0.1),
      flow("interest", "利息", "残高*金利"),
    ];
    const edges: SimEdge[] = [edge("interest", "s", "+")];
    const result = simulate(nodes, edges, { dt: 1, steps: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 複利: 100 → 110 → 121
    expect(result.series.map((s) => s.残高)).toEqual([
      expect.closeTo(100, 6),
      expect.closeTo(110, 6),
      expect.closeTo(121, 6),
    ]);
    expect(result.series.every((s) => s.金利 === 0.1)).toBe(true);
  });

  it("複数 stock は同時更新される（更新済みの値を参照しない）", () => {
    // A と B が互いの flow で増える。同時更新なら両者とも初期値ベースで計算される
    const nodes: SimNode[] = [
      stock("A", "甲", 10),
      stock("B", "乙", 20),
      flow("fromB", "甲増", "乙"),
      flow("fromA", "乙増", "甲"),
    ];
    const edges: SimEdge[] = [edge("fromB", "A", "+"), edge("fromA", "B", "+")];
    const result = simulate(nodes, edges, { dt: 1, steps: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // t=0: 甲=10, 乙=20 → 次の甲=10+20=30, 次の乙=20+10=30
    expect(result.series[1].甲).toBeCloseTo(30, 6);
    expect(result.series[1].乙).toBeCloseTo(30, 6);
  });

  it("order に flow/auxiliary が依存順で並ぶ", () => {
    const { nodes, edges } = fatigueModel();
    const result = simulate(nodes, edges, { dt: 1, steps: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // ミス率 は 残業時間 より前
    expect(result.order.indexOf("ミス率")).toBeLessThan(
      result.order.indexOf("残業時間"),
    );
  });
});

describe("validateExpressionStructure", () => {
  it("四則演算と変数参照は OK（null）", () => {
    expect(validateExpressionStructure("a + b*2 - c/3")).toBeNull();
  });

  it("日本語名を含む式も構文 OK", () => {
    expect(validateExpressionStructure("疲労/100")).toBeNull();
    expect(validateExpressionStructure("8 + ミス率*20")).toBeNull();
  });

  it("空文字は OK（null）", () => {
    expect(validateExpressionStructure("")).toBeNull();
    expect(validateExpressionStructure("   ")).toBeNull();
  });

  it("関数呼び出しは disallowed", () => {
    expect(validateExpressionStructure("sqrt(x)")?.type).toBe("disallowed");
  });

  it("べき乗など四則演算以外の演算子は disallowed", () => {
    expect(validateExpressionStructure("2 ^ 3")?.type).toBe("disallowed");
  });

  it("構文エラーは parse", () => {
    expect(validateExpressionStructure("1 + + *")?.type).toBe("parse");
  });

  it("参照解決はしない（未定義名でも構文が通れば OK）", () => {
    // 保存時は参照の有無を見ない。実行時に解決する方針
    expect(validateExpressionStructure("存在しない名前 + 1")).toBeNull();
  });
});
