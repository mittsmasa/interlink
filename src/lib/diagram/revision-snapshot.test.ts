import { describe, expect, it } from "vitest";
import {
  parseRevisionSnapshot,
  serializeRevisionSnapshot,
  toRevisionSnapshot,
} from "./revision-snapshot";

describe("parseRevisionSnapshot", () => {
  it("後から増えた列を欠いた古い snapshot も読める", () => {
    // kind / expression / status / hasDelay を持たない世代の JSON
    const legacy = JSON.stringify({
      nodes: [{ id: "n1", name: "残業時間" }],
      edges: [
        {
          id: "e1",
          sourceNodeId: "n1",
          targetNodeId: "n1",
          polarity: "+",
        },
      ],
    });
    const snapshot = parseRevisionSnapshot(legacy);
    expect(snapshot.nodes[0]).toMatchObject({
      name: "残業時間",
      kind: null,
      expression: null,
      initialValue: null,
    });
    expect(snapshot.edges[0]).toMatchObject({
      hasDelay: false,
      rationale: "",
      status: "inferred",
      sourceName: "",
    });
  });

  it("nodes / edges ごと欠けていても空の配列として読める", () => {
    expect(parseRevisionSnapshot("{}")).toEqual({ nodes: [], edges: [] });
  });

  it("壊れた JSON では throw する（空の図として復元しないため）", () => {
    expect(() => parseRevisionSnapshot("{ではない")).toThrow();
  });

  it("必須の列を欠いた行では throw する", () => {
    const broken = JSON.stringify({ nodes: [{ name: "ID が無い" }] });
    expect(() => parseRevisionSnapshot(broken)).toThrow();
  });
});

describe("toRevisionSnapshot", () => {
  it("DB 行を JSON に載る形へ落として往復できる", () => {
    const snapshot = toRevisionSnapshot({
      nodes: [
        {
          id: "n1",
          name: "残高",
          memo: null,
          unit: "円",
          kind: "stock",
          expression: null,
          initialValue: 100,
          value: null,
          x: 10,
          y: 20,
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      edges: [
        {
          id: "e1",
          sourceNodeId: "n1",
          targetNodeId: "n1",
          sourceName: "残高",
          targetName: "残高",
          polarity: "-",
          hasDelay: true,
          rationale: "利息",
          status: "confirmed",
          createdAt: 3,
        },
      ],
    });
    expect(parseRevisionSnapshot(serializeRevisionSnapshot(snapshot))).toEqual(
      snapshot,
    );
  });
});
