import { describe, expect, it } from "vitest";
import { matchArchetypes } from "./archetypes";
import type { Loop, LoopEdge } from "./loops";

type Cycle = { loop: Loop; edges: LoopEdge[] };

/**
 * ノード列と各リンクの符号からループとそのエッジを組む。
 * signs[i] は nodeIds[i] → nodeIds[(i+1) % n] の極性で、R/B は負リンク数の偶奇から決まる
 * （detectLoops と同じ規則）。遅れは戻りのリンク（最後の 1 本）に付ける
 */
const cycle = (
  id: string,
  nodeIds: string[],
  signs: ("+" | "-")[],
  hasDelay = false,
): Cycle => {
  const edges: LoopEdge[] = nodeIds.map((nodeId, i) => ({
    id: `${id}:${i}`,
    sourceNodeId: nodeId,
    targetNodeId: nodeIds[(i + 1) % nodeIds.length],
    polarity: signs[i],
    hasDelay: hasDelay && i === nodeIds.length - 1,
  }));
  const negatives = signs.filter((s) => s === "-").length;
  return {
    loop: {
      id,
      label: id.toUpperCase(),
      nodeIds,
      nodeNames: nodeIds,
      edgeIds: edges.map((e) => e.id),
      polarity: negatives % 2 === 0 ? "R" : "B",
      hasDelay,
    },
    edges,
  };
};

const match = (...cycles: Cycle[]) =>
  matchArchetypes(
    cycles.map((c) => c.loop),
    cycles.flatMap((c) => c.edges),
  );

describe("matchArchetypes", () => {
  it("ループがなければ何も出ない", () => {
    expect(matchArchetypes([], [])).toEqual([]);
  });

  it("変数を共有しないループ同士はマッチしない", () => {
    const matches = match(
      cycle("r1", ["a", "b"], ["+", "+"]),
      cycle("b1", ["c", "d"], ["+", "-"]),
    );
    expect(matches).toEqual([]);
  });

  describe("limits-to-growth", () => {
    it("B が負リンクで R の変数に戻っていれば発火する", () => {
      const matches = match(
        cycle("r1", ["顧客数", "口コミ"], ["+", "+"]),
        // 顧客数 →(+) 混雑 →(−) 顧客数
        cycle("b1", ["顧客数", "混雑"], ["+", "-"]),
      );
      expect(matches.map((m) => m.archetypeId)).toEqual(["limits-to-growth"]);
      expect(matches[0].loopIds).toEqual(["r1", "b1"]);
    });

    it("変数を共有するだけ（負リンクが R に戻っていない）では発火しない", () => {
      const matches = match(
        cycle("r1", ["顧客数", "口コミ"], ["+", "+"]),
        // 顧客数 →(−) 在庫 →(+) 顧客数。負リンクは B の内側に閉じている
        cycle("b1", ["顧客数", "在庫"], ["-", "+"]),
      );
      expect(matches).toEqual([]);
    });
  });

  it("R+B 共有で R に遅れ → 応急処置の失敗（成功の限界より先に取る）", () => {
    const matches = match(
      cycle("r1", ["症状", "副作用"], ["+", "+"], true),
      cycle("b1", ["症状", "対処"], ["+", "-"]),
    );
    expect(matches.map((m) => m.archetypeId)).toEqual(["fixes-that-fail"]);
  });

  it("B+B+R 共有 → 問題のすり替わり（同じループへの重ね当てはしない）", () => {
    const matches = match(
      cycle("b1", ["症状", "対症療法"], ["+", "-"]),
      cycle("b2", ["症状", "根本対策"], ["+", "-"]),
      cycle("r1", ["対症療法", "副作用"], ["+", "+"], true),
    );
    expect(matches.map((m) => m.archetypeId)).toEqual(["shifting-the-burden"]);
  });

  it("R+R 共有 → 強者はますます強く", () => {
    const matches = match(
      cycle("r1", ["a の成果", "資源配分"], ["+", "+"]),
      cycle("r2", ["b の成果", "資源配分"], ["+", "+"]),
    );
    expect(matches.map((m) => m.archetypeId)).toEqual([
      "success-to-the-successful",
    ]);
  });

  it("2 つの R が別々の B に抑えられ、B 同士が変数を共有 → 共有地の悲劇", () => {
    const matches = match(
      cycle("r1", ["a の漁獲", "a の設備"], ["+", "+"]),
      cycle("r2", ["b の漁獲", "b の設備"], ["+", "+"]),
      cycle("b1", ["a の漁獲", "漁場の混雑"], ["+", "-"]),
      cycle("b2", ["b の漁獲", "漁場の混雑"], ["+", "-"]),
    );
    expect(matches.map((m) => m.archetypeId)).toEqual([
      "tragedy-of-the-commons",
    ]);
    expect(matches[0].loopIds).toEqual(["r1", "r2", "b1", "b2"]);
    expect(matches[0].question).toContain("漁場の混雑");
  });

  it("B+B 共有 + 遅れあり → 目標のなし崩し", () => {
    const matches = match(
      cycle("b1", ["ギャップ", "実績"], ["+", "-"], true),
      cycle("b2", ["ギャップ", "目標"], ["+", "-"]),
    );
    expect(matches.map((m) => m.archetypeId)).toEqual(["drifting-goals"]);
  });

  it("B+B 共有 + 遅れなし → エスカレーション", () => {
    const matches = match(
      cycle("b1", ["a の行動", "相対的な強さ"], ["+", "-"]),
      cycle("b2", ["b の行動", "相対的な強さ"], ["+", "-"]),
    );
    expect(matches.map((m) => m.archetypeId)).toEqual(["escalation"]);
  });

  it("他の原型に使われずに残った遅れ付き B 単独 → 遅れを伴うバランス", () => {
    const matches = match(cycle("b1", ["在庫", "発注"], ["-", "+"], true));
    expect(matches.map((m) => m.archetypeId)).toEqual(["balancing-with-delay"]);
    expect(matches[0].loopIds).toEqual(["b1"]);
  });

  it("遅れのない B 単独では何も出ない", () => {
    const matches = match(cycle("b1", ["在庫", "発注"], ["-", "+"]));
    expect(matches).toEqual([]);
  });

  it("独立した構造が複数あれば複数の原型を返す", () => {
    const matches = match(
      cycle("r1", ["顧客数", "口コミ"], ["+", "+"]),
      cycle("b1", ["顧客数", "混雑"], ["+", "-"]),
      cycle("r2", ["x", "共有資源"], ["+", "+"]),
      cycle("r3", ["y", "共有資源"], ["+", "+"]),
    );
    expect(matches.map((m) => m.archetypeId).sort()).toEqual([
      "limits-to-growth",
      "success-to-the-successful",
    ]);
  });

  it("どの原型にも処方箋と落とし穴が付いている", () => {
    const matches = match(
      cycle("r1", ["顧客数", "口コミ"], ["+", "+"]),
      cycle("b1", ["顧客数", "混雑"], ["+", "-"]),
      cycle("r2", ["x", "共有資源"], ["+", "+"]),
      cycle("r3", ["y", "共有資源"], ["+", "+"]),
      cycle("b2", ["在庫", "発注"], ["-", "+"], true),
    );
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m.prescription.length).toBeGreaterThan(0);
      expect(m.pitfalls.length).toBeGreaterThan(0);
    }
  });
});
