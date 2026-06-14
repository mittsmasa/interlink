import { describe, expect, it } from "vitest";
import type { DiagramEdge, DiagramNode } from "@/lib/queries/diagrams";
import {
  canSimulate,
  toSimEdges,
  toSimNodes,
  visibleSeriesNames,
} from "./sim-inputs";

/** テスト用に DiagramNode を最小プロパティから組む */
function node(
  partial: Partial<DiagramNode> & { id: string; name: string },
): DiagramNode {
  return {
    projectId: "p1",
    memo: null,
    unit: null,
    kind: null,
    expression: null,
    initialValue: null,
    value: null,
    x: null,
    y: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  } as DiagramNode;
}

function edge(partial: Partial<DiagramEdge> & { id: string }): DiagramEdge {
  return {
    projectId: "p1",
    sourceNodeId: "a",
    targetNodeId: "b",
    polarity: "+",
    hasDelay: false,
    rationale: "r",
    createdAt: 0,
    ...partial,
  } as DiagramEdge;
}

describe("toSimNodes", () => {
  it("kind=null（未分類）のノードは除外される", () => {
    const result = toSimNodes([
      node({ id: "1", name: "未分類", kind: null }),
      node({ id: "2", name: "疲労", kind: "stock", initialValue: 30 }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "2", name: "疲労", kind: "stock" });
  });

  it("kind 付きノードは field をそのまま写す", () => {
    const result = toSimNodes([
      node({
        id: "3",
        name: "回復",
        kind: "flow",
        expression: "疲労 / 10",
        initialValue: null,
        value: null,
      }),
    ]);
    expect(result[0]).toEqual({
      id: "3",
      name: "回復",
      kind: "flow",
      expression: "疲労 / 10",
      initialValue: null,
      value: null,
    });
  });
});

describe("toSimEdges", () => {
  it("polarity（+/-）をそのまま写す", () => {
    const result = toSimEdges([
      edge({ id: "e1", sourceNodeId: "a", targetNodeId: "b", polarity: "+" }),
      edge({ id: "e2", sourceNodeId: "c", targetNodeId: "d", polarity: "-" }),
    ]);
    expect(result).toEqual([
      { sourceNodeId: "a", targetNodeId: "b", polarity: "+" },
      { sourceNodeId: "c", targetNodeId: "d", polarity: "-" },
    ]);
  });
});

describe("canSimulate", () => {
  it("stock を含むと true", () => {
    expect(
      canSimulate(
        toSimNodes([
          node({ id: "1", name: "量", kind: "stock", initialValue: 0 }),
        ]),
      ),
    ).toBe(true);
  });

  it("stock を含まないと false", () => {
    expect(
      canSimulate(
        toSimNodes([
          node({ id: "1", name: "率", kind: "flow", expression: "1" }),
          node({ id: "2", name: "係数", kind: "constant", value: 2 }),
        ]),
      ),
    ).toBe(false);
  });

  it("空（全て未分類）だと false", () => {
    expect(
      canSimulate(toSimNodes([node({ id: "1", name: "x", kind: null })])),
    ).toBe(false);
  });
});

describe("visibleSeriesNames", () => {
  const simNodes = toSimNodes([
    node({ id: "1", name: "残高", kind: "stock", initialValue: 100 }),
    node({ id: "2", name: "利息", kind: "flow", expression: "残高 * 0.1" }),
    node({ id: "3", name: "利率", kind: "auxiliary", expression: "0.1" }),
    node({ id: "4", name: "元本", kind: "constant", value: 100 }),
  ]);

  it("all は全系列を元の順序で返す", () => {
    expect(visibleSeriesNames(simNodes, "all")).toEqual([
      "残高",
      "利息",
      "利率",
      "元本",
    ]);
  });

  it("stock は kind=stock のみ返す", () => {
    expect(visibleSeriesNames(simNodes, "stock")).toEqual(["残高"]);
  });

  it("stock が無ければ空配列", () => {
    const noStock = toSimNodes([
      node({ id: "1", name: "率", kind: "flow", expression: "1" }),
    ]);
    expect(visibleSeriesNames(noStock, "stock")).toEqual([]);
  });
});
