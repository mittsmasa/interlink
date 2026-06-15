import { describe, expect, it } from "vitest";
import { lintDiagram } from "./lint";

const edge = (id: string, sourceNodeId: string, targetNodeId: string) => ({
  id,
  sourceNodeId,
  targetNodeId,
});

describe("lintDiagram", () => {
  it("問題のない図は指摘ゼロ", () => {
    const findings = lintDiagram(
      [
        { id: "a", name: "残業時間" },
        { id: "b", name: "疲労" },
      ],
      [edge("e1", "a", "b"), edge("e2", "b", "a")],
    );
    expect(findings).toEqual([]);
  });

  it("方向語を含む変数名は warning + 取り除いた提案", () => {
    const findings = lintDiagram(
      [{ id: "a", name: "コスト増大" }],
      [edge("e1", "a", "a")],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("direction-in-name");
    expect(findings[0].severity).toBe("warning");
    expect(findings[0].message).toContain("「コスト」");
    expect(findings[0].nodeIds).toEqual(["a"]);
  });

  it("方向語そのものの名前でも空の提案は出さない", () => {
    const findings = lintDiagram([{ id: "a", name: "悪化" }], []);
    const direction = findings.find((f) => f.rule === "direction-in-name");
    expect(direction).toBeDefined();
    expect(direction?.message).not.toContain("「」");
  });

  it("方向語と動詞の両方に該当しても指摘は方向語の 1 件だけ", () => {
    const findings = lintDiagram([{ id: "a", name: "売上を改善する" }], []);
    const forNode = findings.filter((f) => f.nodeIds?.includes("a"));
    expect(forNode.filter((f) => f.severity === "warning")).toHaveLength(1);
    expect(forNode[0].rule).toBe("direction-in-name");
  });

  it("動詞で終わる変数名は warning", () => {
    const findings = lintDiagram([{ id: "a", name: "人を採用する" }], []);
    const verb = findings.find((f) => f.rule === "verb-name");
    expect(verb).toBeDefined();
    expect(verb?.severity).toBe("warning");
  });

  it("孤立ノードは info", () => {
    const findings = lintDiagram(
      [
        { id: "a", name: "残業時間" },
        { id: "b", name: "疲労" },
        { id: "c", name: "士気" },
      ],
      [edge("e1", "a", "b")],
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("isolated-node");
    expect(findings[0].severity).toBe("info");
    expect(findings[0].nodeIds).toEqual(["c"]);
  });

  it("warning が info より先に並ぶ", () => {
    const findings = lintDiagram(
      [
        { id: "a", name: "孤独な変数" },
        { id: "b", name: "コスト増大" },
        { id: "c", name: "疲労" },
      ],
      [edge("e1", "b", "c")],
    );
    expect(findings.map((f) => f.severity)).toEqual(["warning", "info"]);
  });

  describe("missing-dependency-link", () => {
    it("式で参照しているのに因果エッジが無いと info を出す", () => {
      const findings = lintDiagram(
        [
          { id: "balance", name: "残高", kind: "stock" },
          {
            id: "interest",
            name: "利息",
            kind: "flow",
            expression: "残高 * 利率",
          },
          { id: "rate", name: "利率", kind: "constant" },
        ],
        // 利息→残高（流入）はあるが、残高→利息・利率→利息 の依存リンクは図に無い
        [edge("e1", "interest", "balance")],
      );
      const missing = findings.filter(
        (f) => f.rule === "missing-dependency-link",
      );
      expect(missing).toHaveLength(2);
      expect(missing.every((f) => f.severity === "info")).toBe(true);
      // nodeIds は式を持つノード（利息）を指す
      expect(missing.every((f) => f.nodeIds?.[0] === "interest")).toBe(true);
      const fromBalance = missing.find((f) => f.message.includes("「残高」"));
      expect(fromBalance?.message).toContain("「利息」");
      expect(fromBalance?.message).toContain("図にリンクがありません");
    });

    it("同方向の因果エッジが既にあれば出さない（実線優先）", () => {
      const findings = lintDiagram(
        [
          { id: "balance", name: "残高", kind: "stock" },
          { id: "interest", name: "利息", kind: "flow", expression: "残高" },
        ],
        [edge("e1", "balance", "interest")],
      );
      expect(
        findings.filter((f) => f.rule === "missing-dependency-link"),
      ).toHaveLength(0);
    });

    it("式が無ければ出さない（純 CLD は従来どおり）", () => {
      const findings = lintDiagram(
        [
          { id: "a", name: "残業時間" },
          { id: "b", name: "疲労" },
        ],
        [edge("e1", "a", "b"), edge("e2", "b", "a")],
      );
      expect(
        findings.filter((f) => f.rule === "missing-dependency-link"),
      ).toHaveLength(0);
    });
  });
});
