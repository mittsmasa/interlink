import { describe, expect, it } from "vitest";
import { deriveDependencies } from "./dependencies";
import { deriveSignedDependencies } from "./dependency-polarity";

/** from→to の極性を引く小ヘルパ（テストの可読性のため） */
function polarityOf(
  links: ReturnType<typeof deriveSignedDependencies>,
  fromNodeId: string,
  toNodeId: string,
): "+" | "-" | null | undefined {
  return links.find(
    (l) => l.fromNodeId === fromNodeId && l.toNodeId === toNodeId,
  )?.polarity;
}

describe("deriveSignedDependencies", () => {
  it("加算は + 、減算の右辺は −", () => {
    const links = deriveSignedDependencies([
      { id: "a", name: "売上" },
      { id: "b", name: "費用" },
      { id: "c", name: "利益", expression: "売上 - 費用" },
    ]);
    expect(polarityOf(links, "a", "c")).toBe("+"); // 売上↑→利益↑
    expect(polarityOf(links, "b", "c")).toBe("-"); // 費用↑→利益↓
  });

  it("乗算は両因子とも +（変数=正の慣例）", () => {
    const links = deriveSignedDependencies([
      { id: "balance", name: "残高" },
      { id: "rate", name: "利率" },
      { id: "interest", name: "利息", expression: "残高 * 利率" },
    ]);
    expect(polarityOf(links, "balance", "interest")).toBe("+");
    expect(polarityOf(links, "rate", "interest")).toBe("+");
  });

  it("除算は分子 + 、分母 −", () => {
    const links = deriveSignedDependencies([
      { id: "a", name: "総量" },
      { id: "b", name: "人数" },
      { id: "c", name: "一人当たり", expression: "総量 / 人数" },
    ]);
    expect(polarityOf(links, "a", "c")).toBe("+");
    expect(polarityOf(links, "b", "c")).toBe("-");
  });

  it("単項マイナスは符号を反転する", () => {
    const links = deriveSignedDependencies([
      { id: "a", name: "流出" },
      { id: "b", name: "正味", expression: "-流出" },
    ]);
    expect(polarityOf(links, "a", "b")).toBe("-");
  });

  it("ネストした式でも符号を伝播する", () => {
    // 目標 - 実績 を係数倍：実績↑→ギャップ↓
    const links = deriveSignedDependencies([
      { id: "g", name: "目標" },
      { id: "a", name: "実績" },
      { id: "k", name: "係数" },
      { id: "gap", name: "ギャップ", expression: "(目標 - 実績) * 係数" },
    ]);
    expect(polarityOf(links, "g", "gap")).toBe("+");
    expect(polarityOf(links, "a", "gap")).toBe("-");
    expect(polarityOf(links, "k", "gap")).toBe("+");
  });

  it("同じ変数が +/− 両方の文脈に現れる式は null（不定）", () => {
    // 残高 - 残高*0.1（実質 +0.9 だが構造だけでは決まらない）
    const links = deriveSignedDependencies([
      { id: "b", name: "残高" },
      { id: "n", name: "正味", expression: "残高 - 残高 * 0.1" },
    ]);
    expect(polarityOf(links, "b", "n")).toBeNull();
  });

  it("関数の引数に現れる変数は依存リンクは残るが符号は null", () => {
    // sqrt(...) は四則演算外。残高は関数呼び出しトークンではない（直後が `(` でない）ので
    // 依存リンク自体は残るが、構造解析できないため極性は null
    const links = deriveSignedDependencies([
      { id: "b", name: "残高" },
      { id: "r", name: "結果", expression: "sqrt(残高)" },
    ]);
    expect(polarityOf(links, "b", "r")).toBeNull();
  });

  it("CJK ノード名でも極性を導出できる", () => {
    const links = deriveSignedDependencies([
      { id: "x", name: "疲労" },
      { id: "y", name: "生産性", expression: "100 - 疲労" },
    ]);
    expect(polarityOf(links, "x", "y")).toBe("-");
  });

  it("リンクの存在は deriveDependencies と一致する（符号は後付け）", () => {
    const nodes = [
      { id: "a", name: "売上" },
      { id: "b", name: "費用" },
      { id: "c", name: "利益", expression: "売上 - 費用" },
    ];
    const plain = deriveDependencies(nodes)
      .map((l) => l.id)
      .sort();
    const signed = deriveSignedDependencies(nodes)
      .map((l) => l.id)
      .sort();
    expect(signed).toEqual(plain);
  });

  it("式が無ければ空", () => {
    expect(
      deriveSignedDependencies([
        { id: "a", name: "残業時間" },
        { id: "b", name: "疲労" },
      ]),
    ).toEqual([]);
  });
});
