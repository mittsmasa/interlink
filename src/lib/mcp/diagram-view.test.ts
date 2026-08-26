import { describe, expect, it } from "vitest";
import {
  applyLimit,
  collectNeighborhood,
  DIAGRAM_SECTIONS,
  type GraphLink,
  selectSections,
  summarizeRationale,
} from "./diagram-view";

describe("selectSections", () => {
  it("未指定・空配列なら全セクションを返す", () => {
    expect(selectSections()).toEqual(new Set(DIAGRAM_SECTIONS));
    expect(selectSections([])).toEqual(new Set(DIAGRAM_SECTIONS));
  });

  it("指定したセクションだけを返す", () => {
    const sections = selectSections(["nodes", "loops"]);
    expect(sections.size).toBe(2);
    expect(sections.has("nodes")).toBe(true);
    expect(sections.has("loops")).toBe(true);
    expect(sections.has("edges")).toBe(false);
  });
});

describe("applyLimit", () => {
  const items = Array.from({ length: 12 }, (_, i) => i);

  it("上限で切り、切ったことを truncated で伝える", () => {
    const { items: shown, info } = applyLimit(items, 10);
    expect(shown).toHaveLength(10);
    expect(shown[9]).toBe(9);
    expect(info).toEqual({ truncated: true, shown: 10, limit: 10 });
  });

  it("上限に届かなければ truncated は false", () => {
    expect(applyLimit([1, 2], 10).info).toEqual({
      truncated: false,
      shown: 2,
      limit: 10,
    });
  });

  it("上流で既に切られていれば truncated を引き継ぐ", () => {
    expect(applyLimit([1, 2], 10, true).info).toEqual({
      truncated: true,
      shown: 2,
      limit: 10,
    });
  });

  it("limit: null は上限なし（全件返す）", () => {
    const { items: shown, info } = applyLimit(items, null);
    expect(shown).toHaveLength(12);
    expect(info).toEqual({ truncated: false, shown: 12, limit: null });
  });

  it("元の配列を変更しない", () => {
    applyLimit(items, 3);
    expect(items).toHaveLength(12);
  });
});

describe("summarizeRationale", () => {
  it("上限以下はそのまま返す", () => {
    expect(summarizeRationale("残業が続くと疲れが溜まる")).toBe(
      "残業が続くと疲れが溜まる",
    );
    expect(summarizeRationale("あ".repeat(40))).toBe("あ".repeat(40));
  });

  it("上限を超えたら先頭だけ残して省略記号を付ける", () => {
    expect(summarizeRationale("あ".repeat(41))).toBe(`${"あ".repeat(40)}…`);
  });

  it("null はそのまま null", () => {
    expect(summarizeRationale(null)).toBeNull();
  });

  it("サロゲートペアを壊さない", () => {
    expect(summarizeRationale("𩸽".repeat(3), 2)).toBe("𩸽𩸽…");
  });
});

describe("collectNeighborhood", () => {
  // a → b → c → d、および e → b（b の上流）。f はどこにも繋がらない
  const links: GraphLink[] = [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
    { from: "e", to: "b" },
  ];

  it("depth 0 なら自分だけ", () => {
    expect(collectNeighborhood(links, "b", 0)).toEqual(new Set(["b"]));
  });

  it("depth 1 は向きに関係なく直接の前後を含む", () => {
    expect(collectNeighborhood(links, "b", 1)).toEqual(
      new Set(["b", "a", "c", "e"]),
    );
  });

  it("depth 2 で 2 ホップ先まで届く", () => {
    expect(collectNeighborhood(links, "b", 2)).toEqual(
      new Set(["b", "a", "c", "e", "d"]),
    );
  });

  it("到達できないノードは含まない", () => {
    expect(collectNeighborhood(links, "a", 1)).toEqual(new Set(["a", "b"]));
    expect(collectNeighborhood(links, "a", 6).has("f")).toBe(false);
  });

  it("図に無いノードを渡しても自分だけが返る", () => {
    expect(collectNeighborhood(links, "z", 3)).toEqual(new Set(["z"]));
  });

  it("自己ループがあっても無限に辿らない", () => {
    expect(collectNeighborhood([{ from: "a", to: "a" }], "a", 3)).toEqual(
      new Set(["a"]),
    );
  });
});
