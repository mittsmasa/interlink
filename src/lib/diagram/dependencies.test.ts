import { describe, expect, it } from "vitest";
import { deriveDependencies, isCausallyLinked } from "./dependencies";

describe("deriveDependencies", () => {
  it("式が参照するノードを依存リンクとして返す（from=参照先, to=式ノード）", () => {
    const links = deriveDependencies([
      { id: "balance", name: "残高" },
      { id: "interest", name: "利息", expression: "残高 * 利率" },
      { id: "rate", name: "利率" },
    ]);
    expect(links).toContainEqual({
      id: "dep:balance->interest",
      fromNodeId: "balance",
      toNodeId: "interest",
    });
    expect(links).toContainEqual({
      id: "dep:rate->interest",
      fromNodeId: "rate",
      toNodeId: "interest",
    });
    expect(links).toHaveLength(2);
  });

  it("式が無いノードしか無ければ空", () => {
    const links = deriveDependencies([
      { id: "a", name: "残業時間" },
      { id: "b", name: "疲労" },
    ]);
    expect(links).toEqual([]);
  });

  it("自己参照（from === to）は除外する", () => {
    const links = deriveDependencies([
      { id: "x", name: "資本", expression: "資本 * 0.1" },
    ]);
    expect(links).toEqual([]);
  });

  it("同じノードを複数回参照しても 1 本に dedup する", () => {
    const links = deriveDependencies([
      { id: "a", name: "在庫" },
      { id: "b", name: "出荷", expression: "在庫 - 在庫 * 0.1" },
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      id: "dep:a->b",
      fromNodeId: "a",
      toNodeId: "b",
    });
  });

  it("ノード名に一致しないトークン（関数名・未知変数）は無視する", () => {
    const links = deriveDependencies([
      { id: "a", name: "母数" },
      { id: "b", name: "割合", expression: "sqrt(母数) + unknown * 2" },
    ]);
    // sqrt / unknown はノード名でないので拾わない。母数 のみ依存
    expect(links).toEqual([{ id: "dep:a->b", fromNodeId: "a", toNodeId: "b" }]);
  });

  it("数値リテラルの指数部などを識別子と誤認しない", () => {
    const links = deriveDependencies([
      { id: "a", name: "係数", expression: "1e3 + 2.5" },
    ]);
    expect(links).toEqual([]);
  });

  it("空文字・空白のみの式は依存なし", () => {
    const links = deriveDependencies([
      { id: "a", name: "値", expression: "   " },
      { id: "b", name: "別の値", expression: "" },
      { id: "c", name: "未設定", expression: null },
    ]);
    expect(links).toEqual([]);
  });

  it("ノード名と同名でも関数呼び出し形 name(...) は依存に数えない", () => {
    const links = deriveDependencies([
      { id: "a", name: "面積" },
      // 「面積」というノード名と一致するが f(...) 形なので参照ではない
      { id: "b", name: "結果", expression: "面積(2) + 3" },
    ]);
    expect(links).toEqual([]);
  });
});

describe("isCausallyLinked", () => {
  const edges = [
    { sourceNodeId: "balance", targetNodeId: "interest" },
    { sourceNodeId: "a", targetNodeId: "b" },
  ];

  it("同方向の因果エッジがあれば true", () => {
    expect(isCausallyLinked("balance", "interest", edges)).toBe(true);
  });

  it("逆方向しか無ければ false", () => {
    expect(isCausallyLinked("interest", "balance", edges)).toBe(false);
  });

  it("エッジが無ければ false", () => {
    expect(isCausallyLinked("x", "y", edges)).toBe(false);
  });
});
