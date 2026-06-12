import { describe, expect, it } from "vitest";
import { matchArchetypes } from "./archetypes";
import type { Loop } from "./loops";

const loop = (
  id: string,
  polarity: Loop["polarity"],
  nodeIds: string[],
  hasDelay = false,
): Loop => ({
  id,
  label: `${polarity}?`,
  nodeIds,
  nodeNames: nodeIds,
  edgeIds: [],
  polarity,
  hasDelay,
});

describe("matchArchetypes", () => {
  it("ループがなければ何も出ない", () => {
    expect(matchArchetypes([])).toEqual([]);
  });

  it("変数を共有しないループ同士はマッチしない", () => {
    const matches = matchArchetypes([
      loop("r1", "R", ["a", "b"]),
      loop("b1", "B", ["c", "d"]),
    ]);
    expect(matches).toEqual([]);
  });

  it("R+B 共有（R に遅れなし）→ 成功の限界", () => {
    const matches = matchArchetypes([
      loop("r1", "R", ["a", "b"]),
      loop("b1", "B", ["b", "c"]),
    ]);
    expect(matches.map((m) => m.archetypeId)).toEqual(["limits-to-growth"]);
    expect(matches[0].loopIds).toEqual(["r1", "b1"]);
  });

  it("R+B 共有で R に遅れ → 応急処置の失敗", () => {
    const matches = matchArchetypes([
      loop("r1", "R", ["a", "b"], true),
      loop("b1", "B", ["b", "c"]),
    ]);
    expect(matches.map((m) => m.archetypeId)).toEqual(["fixes-that-fail"]);
  });

  it("B+B+R 共有 → 問題のすり替わり（同じループへの重ね当てはしない）", () => {
    const matches = matchArchetypes([
      loop("b1", "B", ["症状", "対症療法"]),
      loop("b2", "B", ["症状", "根本対策"]),
      loop("r1", "R", ["対症療法", "副作用"], true),
    ]);
    expect(matches.map((m) => m.archetypeId)).toEqual(["shifting-the-burden"]);
  });

  it("R+R 共有 → 強者はますます強く", () => {
    const matches = matchArchetypes([
      loop("r1", "R", ["a の成果", "資源配分"]),
      loop("r2", "R", ["b の成果", "資源配分"]),
    ]);
    expect(matches.map((m) => m.archetypeId)).toEqual([
      "success-to-the-successful",
    ]);
  });

  it("B+B 共有 + 遅れあり → 目標のなし崩し", () => {
    const matches = matchArchetypes([
      loop("b1", "B", ["ギャップ", "実績"], true),
      loop("b2", "B", ["ギャップ", "目標"]),
    ]);
    expect(matches.map((m) => m.archetypeId)).toEqual(["drifting-goals"]);
  });

  it("B+B 共有 + 遅れなし → エスカレーション", () => {
    const matches = matchArchetypes([
      loop("b1", "B", ["a の行動", "相対的な強さ"]),
      loop("b2", "B", ["b の行動", "相対的な強さ"]),
    ]);
    expect(matches.map((m) => m.archetypeId)).toEqual(["escalation"]);
  });

  it("独立した構造が複数あれば複数の原型を返す", () => {
    const matches = matchArchetypes([
      loop("r1", "R", ["a", "b"]),
      loop("b1", "B", ["b", "c"]),
      loop("r2", "R", ["x", "共有資源"]),
      loop("r3", "R", ["y", "共有資源"]),
    ]);
    expect(matches.map((m) => m.archetypeId).sort()).toEqual([
      "limits-to-growth",
      "success-to-the-successful",
    ]);
  });
});
