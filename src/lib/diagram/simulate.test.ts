import { describe, expect, it } from "vitest";
import {
  renameExpressionRefs,
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
  hasDelay = false,
): SimEdge => ({ sourceNodeId, targetNodeId, polarity, hasDelay });

/**
 * 目標へ近づく B ループ。補充 =（目標 − 在庫）× 0.5 を在庫へ流し込む。
 * 遅れが無ければ目標へ単調に収束し、遅れが入ると行き過ぎて振動する。
 */
function stockAdjustModel(hasDelay: boolean) {
  const nodes: SimNode[] = [
    stock("s", "在庫", 0),
    constant("g", "目標", 100),
    flow("f", "補充", "(目標 - 在庫) * 0.5"),
  ];
  const edges: SimEdge[] = [edge("f", "s", "+", hasDelay)];
  return { nodes, edges };
}

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
  it("設計ノートの計算例どおり疲労が 30→34→38→42→46 と推移する", () => {
    const { nodes, edges } = fatigueModel();
    const result = simulate(nodes, edges, { dt: 1, steps: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fatigue = result.series.map((s) => s.疲労);
    expect(fatigue[0]).toBeCloseTo(30, 6);
    expect(fatigue[1]).toBeCloseTo(34, 6);
    expect(fatigue[2]).toBeCloseTo(38, 6);
    expect(fatigue[3]).toBeCloseTo(42, 6);
    expect(fatigue[4]).toBeCloseTo(46, 6);
    // t=0 のスナップショットは開始時点の stock + そこから計算した flow/aux
    expect(result.series[0].ミス率).toBeCloseTo(0.3, 6);
    expect(result.series[0].残業時間).toBeCloseTo(14, 6);
    expect(result.series[0].残業増).toBeCloseTo(7, 6);
    expect(result.series[0].回復).toBeCloseTo(3, 6);
    // t=0..steps の steps+1 件
    expect(result.series).toHaveLength(5);
  });

  it("最終スナップショット（t=steps）は最後の stock 更新後の値と、そこから再評価した flow/aux を持つ", () => {
    const { nodes, edges } = fatigueModel();
    const result = simulate(nodes, edges, { dt: 1, steps: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const last = result.series.at(-1);
    expect(last?.t).toBe(4);
    expect(last?.疲労).toBeCloseTo(46, 6);
    // 疲労=46 から再評価: ミス率 0.46 / 残業時間 8+9.2 / 残業増 8.6 / 回復 4.6
    expect(last?.ミス率).toBeCloseTo(0.46, 6);
    expect(last?.残業時間).toBeCloseTo(17.2, 6);
    expect(last?.残業増).toBeCloseTo(8.6, 6);
    expect(last?.回復).toBeCloseTo(4.6, 6);
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

  it("べき乗（^）は pow として許可される", () => {
    const result = simulate([aux("a", "甲", "2 ^ 3")], [], {
      dt: 1,
      steps: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.series[0].甲).toBe(8);
  });

  it("剰余など許可外の演算子は disallowed", () => {
    const result = simulate([aux("a", "甲", "7 % 3")], [], {
      dt: 1,
      steps: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("disallowed");
  });

  describe("関数ホワイトリスト", () => {
    it("min / max / clamp / pow は評価できる", () => {
      const nodes: SimNode[] = [
        stock("s", "量", 12),
        aux(
          "a",
          "甲",
          "clamp(量, 0, 10) + min(量, 3) + max(量, 20) + pow(2, 3)",
        ),
      ];
      const result = simulate(nodes, [], { dt: 1, steps: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.series[0].甲).toBe(10 + 3 + 20 + 8);
    });

    it("ホワイトリスト外の関数は名前入りで disallowed", () => {
      const result = simulate([aux("a", "甲", "floor(1.5)")], [], {
        dt: 1,
        steps: 1,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe("disallowed");
      expect(result.error.message).toContain("floor");
    });

    it("関数名と同名のノードがあっても呼び出しは関数として扱う", () => {
      const nodes: SimNode[] = [
        constant("c", "min", 5),
        aux("a", "甲", "min(min, 2)"),
      ];
      const result = simulate(nodes, [], { dt: 1, steps: 1 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.series[0].甲).toBe(2);
    });

    it("pow が複素数を返す式は eval エラー", () => {
      const result = simulate([aux("a", "甲", "pow(-8, 1/3)")], [], {
        dt: 1,
        steps: 1,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe("eval");
    });
  });

  describe("overrides", () => {
    it("stock の初期値と constant の値を上書きできる（図は変えない）", () => {
      const nodes: SimNode[] = [
        stock("s", "残高", 100),
        constant("r", "利率", 0.1),
        flow("f", "利息", "残高 * 利率"),
      ];
      const edges = [edge("f", "s", "+")];
      const result = simulate(nodes, edges, {
        dt: 1,
        steps: 2,
        overrides: { 残高: 200, 利率: 0.5 },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.series[0].残高).toBe(200);
      expect(result.series[0].利息).toBe(100);
      expect(result.series[1].残高).toBe(300);
      // 入力ノードは書き換えない
      expect(nodes[0].initialValue).toBe(100);
      expect(nodes[1].value).toBe(0.1);
    });

    it("flow / auxiliary の上書きは invalid-override", () => {
      const nodes: SimNode[] = [
        stock("s", "残高", 100),
        flow("f", "利息", "残高 * 0.1"),
      ];
      const result = simulate(nodes, [edge("f", "s")], {
        dt: 1,
        steps: 1,
        overrides: { 利息: 5 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe("invalid-override");
      expect(result.error.refName).toBe("利息");
      expect(result.error.nodeId).toBe("f");
    });

    it("図にない名前の上書きは invalid-override", () => {
      const result = simulate([stock("s", "残高", 100)], [], {
        dt: 1,
        steps: 1,
        overrides: { 存在しない: 1 },
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe("invalid-override");
      expect(result.error.refName).toBe("存在しない");
    });
  });

  describe("nonNegativeStocks", () => {
    const drain = () => ({
      nodes: [stock("s", "在庫", 5), flow("f", "出荷", "4")],
      edges: [edge("f", "s", "-")],
    });

    it("既定では stock は負になれる", () => {
      const { nodes, edges } = drain();
      const result = simulate(nodes, edges, { dt: 1, steps: 3 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // series は t=0..steps の steps+1 件（最終更新後のスナップショットを含む）
      expect(result.series.map((s) => s.在庫)).toEqual([5, 1, -3, -7]);
    });

    it("true なら 0 で止まる", () => {
      const { nodes, edges } = drain();
      const result = simulate(nodes, edges, {
        dt: 1,
        steps: 3,
        nonNegativeStocks: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.series.map((s) => s.在庫)).toEqual([5, 1, 0, 0]);
    });
  });

  it("stock が非有限になったら diverged で打ち切る", () => {
    // flow は有限のまま、stock の加算が倍精度の上限を超えて Infinity になる
    const nodes: SimNode[] = [
      stock("s", "量", 1.7e308),
      flow("f", "増分", "1e308"),
    ];
    const result = simulate(nodes, [edge("f", "s", "+")], {
      dt: 1,
      steps: 10,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("diverged");
    expect(result.error.nodeId).toBe("s");
    expect(result.error.step).toBeGreaterThan(0);
    expect(result.error.step).toBeLessThanOrEqual(10);
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
    // 複利: 100 → 110 → 121 → 133.1（3 回更新した最終値まで入る）
    expect(result.series.map((s) => s.残高)).toEqual([
      expect.closeTo(100, 6),
      expect.closeTo(110, 6),
      expect.closeTo(121, 6),
      expect.closeTo(133.1, 6),
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

describe("リンクの遅れ（hasDelay × delaySteps）", () => {
  it("遅れの無い B ループは目標へ単調に近づく", () => {
    const { nodes, edges } = stockAdjustModel(false);
    const result = simulate(nodes, edges, { dt: 1, steps: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stocks = result.series.map((s) => s.在庫);
    // 単調増加で、目標 100 を一度も超えない
    for (let i = 1; i < stocks.length; i++) {
      expect(stocks[i]).toBeGreaterThan(stocks[i - 1]);
      expect(stocks[i]).toBeLessThanOrEqual(100);
    }
  });

  it("同じ図でも flow→stock に遅れが付くと行き過ぎて振動する", () => {
    const { nodes, edges } = stockAdjustModel(true);
    const result = simulate(nodes, edges, { dt: 1, steps: 8 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stocks = result.series.map((s) => s.在庫);
    // 1 ステップ前の流量で積むので 100 を追い越す
    expect(Math.max(...stocks)).toBeGreaterThan(100);
    // 追い越したあとは減少に転じる（向きが反転する）
    const rises = stocks.slice(1).map((v, i) => v > stocks[i]);
    expect(new Set(rises).size).toBe(2);
  });

  it("式の参照リンクに遅れが付くと、参照値が delaySteps 前の値になる", () => {
    const nodes: SimNode[] = [
      stock("s", "在庫", 0),
      flow("f", "補充", "10"),
      aux("p", "認識在庫", "在庫"),
    ];
    const edges: SimEdge[] = [edge("f", "s"), edge("s", "p", "+", true)];
    const result = simulate(nodes, edges, { dt: 1, steps: 5, delaySteps: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 在庫は 0,10,20,... 認識在庫はその 2 ステップ前（履歴が無い間は t=0 の値）
    expect(result.series.map((s) => s.在庫)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(result.series.map((s) => s.認識在庫)).toEqual([0, 0, 0, 10, 20, 30]);
  });

  it("遅れがあっても評価順序（order）は変わらない", () => {
    const nodes: SimNode[] = [
      stock("s", "在庫", 0),
      aux("p", "認識在庫", "在庫"),
      flow("f", "補充", "認識在庫 * 0.1"),
    ];
    const withDelay = simulate(
      nodes,
      [edge("f", "s"), edge("s", "p", "+", true), edge("p", "f", "+", true)],
      { dt: 1, steps: 3 },
    );
    const withoutDelay = simulate(nodes, [edge("f", "s")], {
      dt: 1,
      steps: 3,
    });
    expect(withDelay.ok && withoutDelay.ok).toBe(true);
    if (!withDelay.ok || !withoutDelay.ok) return;
    expect(withDelay.order).toEqual(["認識在庫", "補充"]);
    expect(withDelay.order).toEqual(withoutDelay.order);
  });

  it("式が参照していないリンクの hasDelay は結果に効かない", () => {
    const nodes: SimNode[] = [
      stock("s", "在庫", 0),
      flow("f", "補充", "10"),
      aux("m", "メモ", "5"),
    ];
    // 補充 → メモ のリンクはあるが、メモの式は補充を参照していない
    const delayed = simulate(
      nodes,
      [edge("f", "s"), edge("f", "m", "+", true)],
      {
        dt: 1,
        steps: 3,
        delaySteps: 2,
      },
    );
    const plain = simulate(nodes, [edge("f", "s"), edge("f", "m")], {
      dt: 1,
      steps: 3,
    });
    expect(delayed.ok && plain.ok).toBe(true);
    if (!delayed.ok || !plain.ok) return;
    expect(delayed.series).toEqual(plain.series);
  });

  it("delaySteps の既定は 1", () => {
    const { nodes, edges } = stockAdjustModel(true);
    const implicit = simulate(nodes, edges, { dt: 1, steps: 5 });
    const explicit = simulate(nodes, edges, { dt: 1, steps: 5, delaySteps: 1 });
    expect(implicit.ok && explicit.ok).toBe(true);
    if (!implicit.ok || !explicit.ok) return;
    expect(implicit.series).toEqual(explicit.series);
  });

  it("delaySteps が 1 未満や小数なら invalid-config", () => {
    const { nodes, edges } = stockAdjustModel(true);
    for (const delaySteps of [0, -1, 1.5]) {
      const result = simulate(nodes, edges, { dt: 1, steps: 3, delaySteps });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.type).toBe("invalid-config");
    }
  });
});

describe("smooth / delay（1 次遅れ）", () => {
  /** 流入 10 で一定に増える水位を smooth で均すモデル */
  function smoothingModel(expression: string) {
    const nodes: SimNode[] = [
      stock("s", "水位", 0),
      flow("f", "流入", "10"),
      aux("a", "均した水位", expression),
    ];
    return { nodes, edges: [edge("f", "s")] };
  }

  it("入力に 1 次遅れで追従する（ds/dt =（x − s）/ tau）", () => {
    const { nodes, edges } = smoothingModel("smooth(水位, 2)");
    const result = simulate(nodes, edges, { dt: 1, steps: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.series.map((s) => s.水位)).toEqual([0, 10, 20, 30, 40, 50]);
    // s(0)=x(0)=0, s(t+1) = s + (x − s)/2
    expect(result.series.map((s) => s.均した水位)).toEqual([
      0, 0, 5, 12.5, 21.25, 30.625,
    ]);
  });

  it("delay は smooth と同じ計算（意味づけだけが違う）", () => {
    const smoothing = smoothingModel("smooth(水位, 2)");
    const delaying = smoothingModel("delay(水位, 2)");
    const config = { dt: 1, steps: 5 };
    const smoothed = simulate(smoothing.nodes, smoothing.edges, config);
    const delayed = simulate(delaying.nodes, delaying.edges, config);
    expect(smoothed.ok && delayed.ok).toBe(true);
    if (!smoothed.ok || !delayed.ok) return;
    expect(delayed.series).toEqual(smoothed.series);
  });

  it("入力が動かなければ隠れストックも初期値のまま", () => {
    const nodes: SimNode[] = [
      stock("s", "水位", 0),
      flow("f", "流入", "均した入力"),
      constant("c", "入力", 10),
      aux("a", "均した入力", "smooth(入力, 4)"),
    ];
    const result = simulate(nodes, [edge("f", "s")], { dt: 1, steps: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.series.map((s) => s.均した入力)).toEqual([
      10, 10, 10, 10, 10,
    ]);
  });

  it("入れ子にすると内側から順に均される", () => {
    const { nodes, edges } = smoothingModel("smooth(smooth(水位, 2), 2)");
    const result = simulate(nodes, edges, { dt: 1, steps: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 内側 0,0,5,12.5,21.25 を さらに均すので立ち上がりが 1 段遅れる
    expect(result.series.map((s) => s.均した水位)).toEqual([0, 0, 0, 2.5, 7.5]);
  });

  it("引数が 2 つでなければ disallowed", () => {
    const { nodes, edges } = smoothingModel("smooth(水位)");
    const result = simulate(nodes, edges, { dt: 1, steps: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("disallowed");
    expect(result.error.message).toContain("引数を 2 つ");
  });

  it("時定数が 0 以下なら eval エラー", () => {
    const { nodes, edges } = smoothingModel("smooth(水位, 0)");
    const result = simulate(nodes, edges, { dt: 1, steps: 2 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.type).toBe("eval");
    expect(result.error.nodeId).toBe("a");
  });

  it("stock を参照しても循環にならない（隠れストックは stock と同じ扱い）", () => {
    const nodes: SimNode[] = [
      stock("s", "在庫", 0),
      constant("g", "目標", 100),
      aux("p", "認識在庫", "smooth(在庫, 3)"),
      flow("f", "補充", "(目標 - 認識在庫) * 0.5"),
    ];
    const result = simulate(nodes, [edge("f", "s")], { dt: 1, steps: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 認識の遅れで行き過ぎ、目標 100 を超えてから戻る
    expect(Math.max(...result.series.map((s) => s.在庫))).toBeGreaterThan(100);
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

  it("べき乗とホワイトリストの関数は OK", () => {
    expect(validateExpressionStructure("2 ^ 3")).toBeNull();
    expect(validateExpressionStructure("clamp(x - y, 0, 上限)")).toBeNull();
    expect(validateExpressionStructure("min(a, b) + max(a, b)")).toBeNull();
  });

  it("許可外の演算子は disallowed", () => {
    expect(validateExpressionStructure("7 % 3")?.type).toBe("disallowed");
  });

  it("構文エラーは parse", () => {
    expect(validateExpressionStructure("1 + + *")?.type).toBe("parse");
  });

  it("参照解決はしない（未定義名でも構文が通れば OK）", () => {
    // 保存時は参照の有無を見ない。実行時に解決する方針
    expect(validateExpressionStructure("存在しない名前 + 1")).toBeNull();
  });
});

describe("renameExpressionRefs", () => {
  it("変数参照の完全一致だけを置き換える", () => {
    expect(
      renameExpressionRefs("残業時間 * 0.5", "残業時間", "労働時間"),
    ).toEqual({ expression: "労働時間 * 0.5", renamed: true });
  });

  it("部分一致する別の変数名は触らない", () => {
    expect(
      renameExpressionRefs("残業時間比率 + 残業時間", "残業時間", "労働時間"),
    ).toEqual({ expression: "残業時間比率 + 労働時間", renamed: true });
  });

  it("同名の関数呼び出しは変数参照ではないので触らない", () => {
    expect(renameExpressionRefs("min(a, b)", "min", "最小")).toEqual({
      expression: "min(a, b)",
      renamed: false,
    });
  });

  it("参照が無ければ renamed: false", () => {
    expect(renameExpressionRefs("在庫 * 2", "残業時間", "労働時間")).toEqual({
      expression: "在庫 * 2",
      renamed: false,
    });
  });

  it("置き換えた式はそのまま実行できる", () => {
    const { expression } = renameExpressionRefs(
      "clamp(残業時間 - 休息, 0, 上限)",
      "残業時間",
      "労働時間",
    );
    expect(expression).toBe("clamp(労働時間 - 休息, 0, 上限)");
    expect(validateExpressionStructure(expression)).toBeNull();
  });
});
