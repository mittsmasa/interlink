import { describe, expect, it } from "vitest";
import { chooseBulgeSigns } from "./floating-edge-utils";

const positions = new Map([
  ["a", { x: 0, y: 0 }],
  ["b", { x: 300, y: 0 }],
  ["c", { x: 150, y: 200 }],
]);

describe("chooseBulgeSigns", () => {
  it("双方向ペアは同符号（進行方向基準の法線が逆向きのため物理的に逆側へ分かれる）", () => {
    const signs = chooseBulgeSigns(
      [
        { id: "e1", sourceNodeId: "a", targetNodeId: "b" },
        { id: "e2", sourceNodeId: "b", targetNodeId: "a" },
      ],
      positions,
    );
    expect(signs.get("e1")).toBe(1);
    expect(signs.get("e2")).toBe(1);
  });

  it("第三のノードから遠い側に膨らむ", () => {
    // a→b の下（y 正方向）に c がいる。膨らみは c から遠い上側を選ぶはず
    const signs = chooseBulgeSigns(
      [{ id: "e1", sourceNodeId: "a", targetNodeId: "b" }],
      positions,
    );
    const sign = signs.get("e1");
    // a→b (dx=300, dy=0): apex は sign=1 で (150, 54)、sign=-1 で (150, -54)。
    // c=(150,200) から遠いのは y=-54 側 = sign:-1
    expect(sign).toBe(-1);
  });

  it("他ノードがなければ既定の側（+1）", () => {
    const twoNodes = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 300, y: 0 }],
    ]);
    const signs = chooseBulgeSigns(
      [{ id: "e1", sourceNodeId: "a", targetNodeId: "b" }],
      twoNodes,
    );
    expect(signs.get("e1")).toBe(1);
  });

  it("自己ループは常に +1", () => {
    const signs = chooseBulgeSigns(
      [{ id: "e1", sourceNodeId: "a", targetNodeId: "a" }],
      positions,
    );
    expect(signs.get("e1")).toBe(1);
  });
});
