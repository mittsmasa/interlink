import { describe, expect, it } from "vitest";
import {
  classifyBehavior,
  findBehaviorMismatch,
  summarizeSimulation,
  thinSeries,
} from "./sim-summary";
import { type SimEdge, type SimNode, simulate } from "./simulate";

/** 数列を t 付きスナップショット列に包む */
function seriesOf(name: string, values: number[]) {
  return values.map((v, t) => ({ t, [name]: v }));
}

describe("classifyBehavior", () => {
  it("指数成長は increasing", () => {
    const values = Array.from({ length: 20 }, (_, i) => 1.2 ** i);
    expect(classifyBehavior(values)).toBe("increasing");
  });

  it("線形増加も increasing", () => {
    expect(classifyBehavior([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(
      "increasing",
    );
  });

  it("S 字（ロジスティック）は末尾が平らになり plateau", () => {
    const values = Array.from(
      { length: 40 },
      (_, i) => 100 / (1 + Math.exp(-(i - 15) / 2)),
    );
    expect(classifyBehavior(values)).toBe("plateau");
  });

  it("目標値へ漸近する収束も plateau", () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 * (1 - 0.7 ** i));
    expect(classifyBehavior(values)).toBe("plateau");
  });

  it("減衰振動は oscillating", () => {
    const values = Array.from(
      { length: 40 },
      (_, i) => 50 + 30 * Math.cos(i / 2) * 0.95 ** i,
    );
    expect(classifyBehavior(values)).toBe("oscillating");
  });

  it("単調減少は decreasing", () => {
    const values = Array.from({ length: 20 }, (_, i) => 100 * 0.8 ** i);
    expect(classifyBehavior(values)).toBe("decreasing");
  });

  it("上がってから下がる山型は improved-then-worse", () => {
    expect(classifyBehavior([10, 20, 30, 40, 30, 20, 10, 5])).toBe(
      "improved-then-worse",
    );
  });

  it("下がってから上がる谷型は other", () => {
    expect(classifyBehavior([40, 30, 20, 10, 20, 30, 40, 50])).toBe("other");
  });

  it("変化しない数列は plateau", () => {
    expect(classifyBehavior([5, 5, 5, 5])).toBe("plateau");
  });

  it("数値ノイズ程度の揺れは振動とみなさない", () => {
    const values = Array.from(
      { length: 20 },
      (_, i) => 10 + i + (i % 2) * 1e-9,
    );
    expect(classifyBehavior(values)).toBe("increasing");
  });

  it("点が 1 つしかなければ other", () => {
    expect(classifyBehavior([1])).toBe("other");
  });
});

describe("thinSeries", () => {
  it("点数が上限以下ならそのまま", () => {
    const s = [1, 2, 3];
    expect(thinSeries(s, 5)).toBe(s);
  });

  it("等間隔に間引き、先頭と末尾を必ず残す", () => {
    const s = Array.from({ length: 101 }, (_, i) => i);
    const thinned = thinSeries(s, 11);
    expect(thinned).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it("割り切れない長さでも重複せず末尾を含む", () => {
    const s = Array.from({ length: 23 }, (_, i) => i);
    const thinned = thinSeries(s, 5);
    expect(thinned[0]).toBe(0);
    expect(thinned[thinned.length - 1]).toBe(22);
    expect(new Set(thinned).size).toBe(thinned.length);
    expect(thinned.length).toBeLessThanOrEqual(5);
  });
});

describe("summarizeSimulation", () => {
  it("stock ごとに initial / final / min / max / trend / pattern を出し series を間引く", () => {
    const series = seriesOf(
      "残高",
      Array.from({ length: 50 }, (_, i) => 100 * 1.05 ** i),
    );
    const summary = summarizeSimulation(series, { dt: 1, steps: 50 }, ["残高"]);
    expect(summary.stocks).toHaveLength(1);
    const [s] = summary.stocks;
    expect(s.name).toBe("残高");
    expect(s.initial).toBe(100);
    // final は series 末尾の値として定義する
    expect(s.final).toBeCloseTo(100 * 1.05 ** 49, 6);
    expect(s.min).toBe(100);
    expect(s.max).toBe(s.final);
    expect(s.trend).toBe("up");
    expect(s.pattern).toBe("increasing");
    expect(summary.totalPoints).toBe(50);
    expect(summary.series.length).toBeLessThanOrEqual(21);
    expect(summary.series[0].t).toBe(0);
    expect(summary.series[summary.series.length - 1].t).toBe(49);
  });

  it("減る stock は trend=down、動かない stock は flat", () => {
    const series = [
      { t: 0, 在庫: 10, 上限: 5 },
      { t: 1, 在庫: 8, 上限: 5 },
      { t: 2, 在庫: 6, 上限: 5 },
    ];
    const summary = summarizeSimulation(series, { dt: 1, steps: 3 }, [
      "在庫",
      "上限",
    ]);
    expect(summary.stocks.map((s) => s.trend)).toEqual(["down", "flat"]);
  });

  it("simulate の結果をそのまま要約できる（疲労モデル）", () => {
    const nodes: SimNode[] = [
      { id: "fatigue", name: "疲労", kind: "stock", initialValue: 30 },
      { id: "up", name: "残業増", kind: "flow", expression: "疲労 * 0.2" },
      { id: "rec", name: "回復", kind: "flow", expression: "疲労 * 0.1" },
    ];
    const edges: SimEdge[] = [
      { sourceNodeId: "up", targetNodeId: "fatigue", polarity: "+" },
      { sourceNodeId: "rec", targetNodeId: "fatigue", polarity: "-" },
    ];
    const config = { dt: 1, steps: 20 };
    const result = simulate(nodes, edges, config);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const summary = summarizeSimulation(result.series, config, ["疲労"]);
    expect(summary.stocks[0]).toMatchObject({
      name: "疲労",
      initial: 30,
      trend: "up",
      pattern: "increasing",
    });
    expect(summary.stocks[0].final).toBe(
      result.series[result.series.length - 1].疲労,
    );
  });
});

describe("findBehaviorMismatch", () => {
  const stocks = [
    { name: "疲労", pattern: "increasing" as const },
    { name: "信頼", pattern: "decreasing" as const },
  ];

  it("ノート未記入なら null", () => {
    expect(findBehaviorMismatch(null, stocks)).toBeNull();
    expect(findBehaviorMismatch(undefined, stocks)).toBeNull();
  });

  it("いずれかの stock が一致すれば null", () => {
    expect(findBehaviorMismatch("increasing", stocks)).toBeNull();
    expect(findBehaviorMismatch("decreasing", stocks)).toBeNull();
  });

  it("どの stock も一致しなければ mismatch", () => {
    const mismatch = findBehaviorMismatch("oscillating", stocks);
    expect(mismatch?.noted).toBe("oscillating");
    expect(mismatch?.observed).toEqual(stocks);
    expect(mismatch?.message).toContain("振動している");
    expect(mismatch?.message).toContain("疲労=増え続けている");
  });

  it("stock が無ければ判定しない", () => {
    expect(findBehaviorMismatch("increasing", [])).toBeNull();
  });
});
