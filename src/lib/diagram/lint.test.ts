import { describe, expect, it } from "vitest";
import type { EdgeStatus } from "@/db/schema";
import { type LintFinding, lintDiagram } from "./lint";
import type { Loop } from "./loops";

const edge = (
  id: string,
  sourceNodeId: string,
  targetNodeId: string,
  status?: EdgeStatus,
) => ({
  id,
  sourceNodeId,
  targetNodeId,
  ...(status ? { status } : {}),
});

describe("lintDiagram", () => {
  it("問題のない図は指摘ゼロ", () => {
    const findings = lintDiagram(
      [
        { id: "a", name: "残業時間" },
        { id: "b", name: "疲労" },
        { id: "c", name: "作業効率" },
      ],
      [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a")],
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

  describe("bidirectional-link", () => {
    it("A→B と B→A が両方あれば 1 件の info にまとめ、両エッジを指す", () => {
      const findings = lintDiagram(
        [
          { id: "a", name: "残業時間" },
          { id: "b", name: "疲労" },
        ],
        [edge("e1", "a", "b"), edge("e2", "b", "a")],
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        rule: "bidirectional-link",
        severity: "info",
        nodeIds: ["a", "b"],
        edgeIds: ["e1", "e2"],
      });
      expect(findings[0].message).toContain("どちらが先に動きますか");
      expect(findings[0].message).toContain("間に挟まる変数");
    });

    it("自己ループは双方向とみなさない", () => {
      const findings = lintDiagram(
        [{ id: "a", name: "残業時間" }],
        [edge("e1", "a", "a")],
      );
      expect(findings).toEqual([]);
    });
  });

  describe("conflicting-link", () => {
    const nodes = [
      { id: "a", name: "残業時間" },
      { id: "b", name: "疲労" },
    ];
    const signed = (
      id: string,
      sourceNodeId: string,
      targetNodeId: string,
      polarity: "+" | "-",
    ) => ({ id, sourceNodeId, targetNodeId, polarity });

    it("同じペアに + と − が並んでいたら warning にし、両エッジを指す", () => {
      const findings = lintDiagram(nodes, [
        signed("e1", "a", "b", "+"),
        signed("e2", "a", "b", "-"),
      ]);
      const conflicts = findings.filter((f) => f.rule === "conflicting-link");
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({
        severity: "warning",
        nodeIds: ["a", "b"],
        edgeIds: ["e1", "e2"],
      });
      expect(conflicts[0].message).toContain(
        "「残業時間」→「疲労」の極性が + と − で食い違っています",
      );
      expect(conflicts[0].message).toContain("どちらが実感に近いですか");
    });

    it("同じペアでも極性が揃っていれば出さない", () => {
      const findings = lintDiagram(nodes, [
        signed("e1", "a", "b", "+"),
        signed("e2", "a", "b", "+"),
      ]);
      expect(findings.filter((f) => f.rule === "conflicting-link")).toEqual([]);
    });

    it("向きが逆のペアは食い違いではなく bidirectional-link のまま", () => {
      const findings = lintDiagram(nodes, [
        signed("e1", "a", "b", "+"),
        signed("e2", "b", "a", "-"),
      ]);
      expect(findings.map((f) => f.rule)).toEqual(["bidirectional-link"]);
    });

    it("極性が渡されていなければ判定しない", () => {
      const findings = lintDiagram(nodes, [
        edge("e1", "a", "b"),
        edge("e2", "a", "b"),
      ]);
      expect(findings.filter((f) => f.rule === "conflicting-link")).toEqual([]);
    });
  });

  describe("speculative-link", () => {
    const nodes = [
      { id: "a", name: "残業時間" },
      { id: "b", name: "疲労" },
      { id: "c", name: "作業効率" },
    ];
    const edges = [
      edge("e1", "a", "b", "inferred"),
      edge("e2", "b", "c", "inferred"),
      edge("e3", "c", "a", "confirmed"),
      // ループ外の推測リンク
      edge("e4", "a", "c", "inferred"),
    ];
    const loop: Loop = {
      id: "loop:a→b→c",
      label: "R1",
      nodeIds: ["a", "b", "c"],
      nodeNames: ["残業時間", "疲労", "作業効率"],
      edgeIds: ["e1", "e2", "e3"],
      polarity: "R",
      hasDelay: false,
    };

    it("確認済みループの外にある inferred リンクだけを info にする", () => {
      const findings = lintDiagram(nodes, edges, {
        loops: [loop],
        confirmedLoopIds: [loop.id],
      });
      const speculative = findings.filter((f) => f.rule === "speculative-link");
      expect(speculative).toHaveLength(1);
      expect(speculative[0]).toMatchObject({
        severity: "info",
        edgeIds: ["e4"],
      });
      expect(speculative[0].message).toContain("「残業時間→作業効率」");
    });

    it("確認済みループが 1 つもなければ出さない", () => {
      const findings = lintDiagram(nodes, edges, {
        loops: [loop],
        confirmedLoopIds: [],
      });
      expect(findings.some((f) => f.rule === "speculative-link")).toBe(false);
    });

    it("status が未指定のエッジは対象にしない", () => {
      const findings = lintDiagram(nodes, [edge("e4", "a", "c")], {
        loops: [loop],
        confirmedLoopIds: [loop.id],
      });
      expect(findings.some((f) => f.rule === "speculative-link")).toBe(false);
    });
  });
});

describe("lintDiagram: SFD 整合ルール", () => {
  const stockNode = (id: string, name: string) => ({
    id,
    name,
    kind: "stock",
  });
  const flowNode = (id: string, name: string, expression = "1") => ({
    id,
    name,
    kind: "flow",
    expression,
  });

  it("flow → stock と stock が揃っていれば指摘なし", () => {
    const findings = lintDiagram(
      [stockNode("s", "在庫"), flowNode("f", "入荷")],
      [edge("e1", "f", "s")],
    );
    expect(findings.filter((f) => f.severity === "warning")).toEqual([]);
  });

  it("stock へ繋がらない flow は flow-without-stock", () => {
    const findings = lintDiagram(
      [
        stockNode("s", "在庫"),
        flowNode("f", "入荷"),
        { id: "x", name: "需要" },
      ],
      [edge("e1", "f", "x"), edge("e2", "x", "s")],
    );
    const finding = findings.find((f) => f.rule === "flow-without-stock");
    expect(finding?.severity).toBe("warning");
    expect(finding?.nodeIds).toEqual(["f"]);
  });

  it("flow の無い stock は stock-without-flow", () => {
    const findings = lintDiagram(
      [stockNode("s", "在庫"), { id: "x", name: "需要" }],
      [edge("e1", "x", "s")],
    );
    const finding = findings.find((f) => f.rule === "stock-without-flow");
    expect(finding?.nodeIds).toEqual(["s"]);
  });

  it("stock → stock のエッジは stock-to-stock-edge（edgeIds 付き）", () => {
    const findings = lintDiagram(
      [
        stockNode("a", "在庫"),
        stockNode("b", "売上累計"),
        flowNode("f", "入荷"),
        flowNode("g", "計上"),
      ],
      [edge("e1", "f", "a"), edge("e2", "g", "b"), edge("e3", "a", "b")],
    );
    const finding = findings.find((f) => f.rule === "stock-to-stock-edge");
    expect(finding?.edgeIds).toEqual(["e3"]);
    expect(finding?.message).toContain("「在庫」→「売上累計」");
  });

  it("式が図にない変数を参照していれば undefined-reference（関数名は除く）", () => {
    const findings = lintDiagram(
      [stockNode("s", "在庫"), flowNode("f", "入荷", "min(需要, 上限) + 在庫")],
      [edge("e1", "f", "s")],
    );
    const finding = findings.find((f) => f.rule === "undefined-reference");
    expect(finding?.severity).toBe("warning");
    expect(finding?.nodeIds).toEqual(["f"]);
    expect(finding?.message).toContain("「需要」「上限」");
    expect(finding?.message).not.toContain("min");
  });

  it("smooth / delay は関数名なので undefined-reference にならない", () => {
    const findings = lintDiagram(
      [stockNode("s", "在庫"), flowNode("f", "入荷", "smooth(在庫, 3) * 0.5")],
      [edge("e1", "f", "s")],
    );
    expect(
      findings.find((f) => f.rule === "undefined-reference"),
    ).toBeUndefined();
  });

  it("kind の無い CLD には SFD ルールを出さない", () => {
    const findings = lintDiagram(
      [
        { id: "a", name: "残業時間" },
        { id: "b", name: "疲労" },
        { id: "c", name: "作業効率" },
      ],
      [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "a")],
    );
    expect(findings).toEqual([]);
  });
});

describe("lintDiagram: 単位の整合", () => {
  const stock = (id: string, name: string, unit: string | null) => ({
    id,
    name,
    unit,
    kind: "stock",
  });
  const flow = (id: string, name: string, unit: string | null) => ({
    id,
    name,
    unit,
    kind: "flow",
    expression: "1",
  });
  const mismatches = (findings: LintFinding[]) =>
    findings.filter((f) => f.rule === "unit-mismatch-flow");

  it("flow が「ストックの単位/時間」の率なら指摘しない", () => {
    const findings = lintDiagram(
      [stock("s", "疲労", "ポイント"), flow("f", "残業増", "ポイント/日")],
      [edge("e1", "f", "s")],
    );
    expect(mismatches(findings)).toEqual([]);
  });

  it("flow の単位が時点の量なら unit-mismatch-flow（直し方まで書く）", () => {
    const findings = lintDiagram(
      [stock("s", "疲労", "ポイント"), flow("f", "残業増", "回")],
      [edge("e1", "f", "s")],
    );
    const finding = mismatches(findings)[0];
    expect(finding).toMatchObject({
      severity: "warning",
      nodeIds: ["f"],
      edgeIds: ["e1"],
    });
    expect(finding?.message).toContain("「残業増」の単位が「回」");
    expect(finding?.message).toContain("ストック「疲労」（単位: ポイント）");
    expect(finding?.message).toContain("「ポイント/日」");
  });

  it("率でも分子の量が違えば unit-mismatch-flow（時間単位は flow に合わせて見せる）", () => {
    const findings = lintDiagram(
      [stock("s", "疲労", "ポイント"), flow("f", "残業増", "件/週")],
      [edge("e1", "f", "s")],
    );
    const finding = mismatches(findings)[0];
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("「ポイント/週」");
  });

  it("英語表記でも量が揃っていれば指摘しない", () => {
    const findings = lintDiagram(
      [stock("s", "在庫", "Units"), flow("f", "入荷", "unit/day")],
      [edge("e1", "f", "s")],
    );
    expect(mismatches(findings)).toEqual([]);
  });

  it("読めない単位・時間でない分母は判定しない", () => {
    const unknown = lintDiagram(
      [stock("s", "残高", "円"), flow("f", "利息", "円/人")],
      [edge("e1", "f", "s")],
    );
    expect(mismatches(unknown)).toEqual([]);

    const empty = lintDiagram(
      [stock("s", "残高", "円"), flow("f", "利息", null)],
      [edge("e1", "f", "s")],
    );
    expect(mismatches(empty)).toEqual([]);
  });

  it("stock 自身が率なら判定しない（平滑化した成長率など）", () => {
    const findings = lintDiagram(
      [stock("s", "認識成長率", "%/年"), flow("f", "認識の更新", "%/月")],
      [edge("e1", "f", "s")],
    );
    expect(mismatches(findings)).toEqual([]);
  });

  it("flow → stock 以外のリンクは見ない", () => {
    const findings = lintDiagram(
      [
        stock("s", "疲労", "ポイント"),
        flow("f", "残業増", "ポイント/日"),
        {
          id: "a",
          name: "ミス率",
          kind: "auxiliary",
          unit: "回",
          expression: "疲労/100",
        },
      ],
      [edge("e1", "f", "s"), edge("e2", "a", "s")],
    );
    expect(mismatches(findings)).toEqual([]);
  });

  it("kind の無い CLD では単位を見ない", () => {
    const findings = lintDiagram(
      [
        { id: "a", name: "残業時間", unit: "回" },
        { id: "b", name: "疲労", unit: "ポイント" },
      ],
      [edge("e1", "a", "b")],
    );
    expect(findings).toEqual([]);
  });

  it("stock / flow に単位が無ければ unit-missing-on-sfd（info）", () => {
    const findings = lintDiagram(
      [stock("s", "疲労", null), flow("f", "残業増", "  ")],
      [edge("e1", "f", "s")],
    );
    const missing = findings.filter((f) => f.rule === "unit-missing-on-sfd");
    expect(missing).toHaveLength(2);
    expect(missing.every((f) => f.severity === "info")).toBe(true);
    expect(missing[0]?.message).toContain("stock「疲労」に単位がありません");
    expect(missing[1]?.message).toContain("「ポイント/日」のような");
  });

  it("auxiliary / constant と CLD ノードには unit-missing-on-sfd を出さない", () => {
    const findings = lintDiagram(
      [
        stock("s", "疲労", "ポイント"),
        flow("f", "残業増", "ポイント/日"),
        { id: "a", name: "ミス率", kind: "auxiliary", expression: "疲労/100" },
        { id: "c", name: "体力上限", kind: "constant" },
        { id: "n", name: "残業時間" },
      ],
      [edge("e1", "f", "s")],
    );
    expect(findings.some((f) => f.rule === "unit-missing-on-sfd")).toBe(false);
  });
});
