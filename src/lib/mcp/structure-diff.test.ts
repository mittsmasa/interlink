import { describe, expect, it } from "vitest";
import type { LintFinding } from "@/lib/diagram/lint";
import type { Loop } from "@/lib/diagram/loops";
import { diffStructure } from "./structure-diff";

function loop(id: string, polarity: Loop["polarity"] = "R"): Loop {
  return {
    id,
    label: `${polarity}1`,
    nodeIds: ["a", "b"],
    nodeNames: ["A", "B"],
    edgeIds: ["e1", "e2"],
    polarity,
    hasDelay: false,
  };
}

const finding = (
  rule: LintFinding["rule"],
  nodeIds: string[],
): LintFinding => ({
  rule,
  severity: "warning",
  message: "m",
  nodeIds,
});

describe("diffStructure", () => {
  it("閉じた / 開いたループを id で判定し要約を返す", () => {
    const result = diffStructure(
      { loops: [loop("L1"), loop("L2", "B")], findings: [] },
      { loops: [loop("L2", "B"), loop("L3")], findings: [] },
    );
    expect(result.closedLoops).toEqual([
      { id: "L3", label: "R1", polarity: "R", nodeNames: ["A", "B"] },
    ]);
    expect(result.openedLoops.map((l) => l.id)).toEqual(["L1"]);
  });

  it("新しい lint 指摘だけを newFindings に載せる", () => {
    const result = diffStructure(
      { loops: [], findings: [finding("isolated-node", ["n1"])] },
      {
        loops: [],
        findings: [
          finding("isolated-node", ["n1"]),
          finding("verb-name", ["n2"]),
        ],
      },
    );
    expect(result.newFindings).toEqual([finding("verb-name", ["n2"])]);
  });

  it("変化がなければ全部空", () => {
    const result = diffStructure(
      { loops: [loop("L1")], findings: [] },
      { loops: [loop("L1")], findings: [] },
    );
    expect(result).toEqual({
      closedLoops: [],
      openedLoops: [],
      newFindings: [],
    });
  });
});
