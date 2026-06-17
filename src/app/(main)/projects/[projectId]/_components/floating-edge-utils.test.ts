import { describe, expect, it } from "vitest";
import { chooseBulgeSigns } from "./floating-edge-utils";

const positions = new Map([
  ["a", { x: 0, y: 0 }],
  ["b", { x: 300, y: 0 }],
  ["c", { x: 150, y: 200 }],
]);

// 重心外向きとノード回避が背反する配置。a→b の弦に対し、避けるべき近接ノード c は
// 上側（y<0）にあるが、重心は下方の d/e に引かれて y>0 になる。
// → ノード回避は下側 sign=+1、重心外向きは（重心から遠い）上側 sign=-1 を選び、結果が割れる。
const ringDisagreePositions = new Map([
  ["a", { x: 0, y: 0 }],
  ["b", { x: 300, y: 0 }],
  ["c", { x: 150, y: -80 }],
  ["d", { x: 100, y: 400 }],
  ["e", { x: 200, y: 400 }],
]);
const abEdge = [{ id: "e1", sourceNodeId: "a", targetNodeId: "b" }];

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

  it("ring 指定なしはノード回避（近接ノードを避ける下側 +1）", () => {
    const signs = chooseBulgeSigns(abEdge, ringDisagreePositions);
    expect(signs.get("e1")).toBe(1);
  });

  it("両端が ring 上なら重心外向き（ノード回避とは逆の上側 -1）", () => {
    const signs = chooseBulgeSigns(
      abEdge,
      ringDisagreePositions,
      new Set(["a", "b"]),
    );
    expect(signs.get("e1")).toBe(-1);
  });

  it("片端だけ ring 上ならノード回避のまま（+1）", () => {
    const signs = chooseBulgeSigns(
      abEdge,
      ringDisagreePositions,
      new Set(["a"]),
    );
    expect(signs.get("e1")).toBe(1);
  });
});
