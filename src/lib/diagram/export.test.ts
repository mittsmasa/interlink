import { describe, expect, it } from "vitest";
import type { ArchetypeMatch } from "./archetypes";
import {
  type ExportDiagram,
  exportDiagramToMarkdown,
  exportDiagramToMermaid,
  renderDiagramExport,
} from "./export";
import type { Loop } from "./loops";

const diagram: ExportDiagram = {
  nodes: [
    { name: "残業時間", memo: "月の合計", unit: "時間", kind: "stock" },
    { name: "疲労", kind: "auxiliary", expression: "残業時間 * 0.5" },
    { name: "採用数", kind: "flow" },
    { name: "予算", kind: "constant", value: 100 },
    { name: "士気" },
  ],
  edges: [
    {
      sourceName: "残業時間",
      targetName: "疲労",
      polarity: "+",
      hasDelay: false,
      rationale: "残業が続くと疲れが溜まる",
    },
    {
      sourceName: "疲労",
      targetName: "残業時間",
      polarity: "+",
      hasDelay: true,
      rationale: "疲れると効率が落ち | 残業が増える",
    },
    {
      sourceName: "予算",
      targetName: "採用数",
      polarity: "-",
      hasDelay: false,
      rationale: "",
    },
  ],
};

const loops: Loop[] = [
  {
    id: "loop:a→b",
    label: "R1",
    nodeIds: ["a", "b"],
    nodeNames: ["残業時間", "疲労"],
    edgeIds: ["e1", "e2"],
    polarity: "R",
    hasDelay: true,
  },
];

describe("exportDiagramToMermaid", () => {
  it("極性ラベル・遅れの点線・kind 別の形状・ループコメントを出す", () => {
    const text = exportDiagramToMermaid(diagram, loops);
    const lines = text.split("\n");
    expect(lines[0]).toBe("graph LR");
    expect(text).toContain('n0[("残業時間")]'); // stock
    expect(text).toContain('n1("疲労")'); // auxiliary
    expect(text).toContain('n2[/"採用数"/]'); // flow
    expect(text).toContain('n3{{"予算"}}'); // constant
    expect(text).toContain('n4["士気"]'); // 未分類
    expect(text).toContain('n0 -- "+" --> n1');
    expect(text).toContain('n1 -. "+" .-> n0'); // 遅れ
    expect(text).toContain('n3 -- "-" --> n2');
    expect(text).toContain(
      "%% R1（自己強化、遅れあり）: 残業時間 → 疲労 → 残業時間",
    );
  });

  it("変数名のダブルクォートをエスケープする", () => {
    const text = exportDiagramToMermaid(
      { nodes: [{ name: '"引用"付き' }], edges: [] },
      [],
    );
    expect(text).toContain('n0["#quot;引用#quot;付き"]');
  });

  it("図が空ならコメントだけ", () => {
    const text = exportDiagramToMermaid({ nodes: [], edges: [] }, []);
    expect(text).toBe("graph LR\n  %% （まだ図はありません）");
  });
});

describe("exportDiagramToMarkdown", () => {
  const matches: ArchetypeMatch[] = [
    {
      archetypeId: "fixes-that-fail",
      name: "応急処置の失敗",
      description: "対処が副作用で問題を悪化させる構造",
      question: "対処の副作用はありますか",
      loopIds: ["loop:a→b"],
    },
  ];

  it("変数表・リンク表・ループ・原型・ノートの各節を出す", () => {
    const text = exportDiagramToMarkdown({
      title: "残業が減らない",
      diagram,
      loops,
      matches,
      notes: {
        theme: "残業が減らない",
        behavior: { pattern: "increasing", description: "半年前から増加" },
        idealBehavior: "月 20 時間以内",
        stakeholders: [{ name: "マネージャ", concerns: ["納期", "離職"] }],
        variableCandidates: [{ name: "離職率", source: "マネージャ" }],
        confirmedLoopIds: ["loop:a→b"],
      },
    });
    expect(text.startsWith("# 残業が減らない\n")).toBe(true);
    expect(text).toContain("| 残業時間 | ストック | 時間 | 月の合計 |  |");
    expect(text).toContain("| 疲労 | 補助変数 |  |  | 式: 残業時間 * 0.5 |");
    expect(text).toContain("| 予算 | 定数 |  |  | 値: 100 |");
    // 縦棒を含む根拠はセルを壊さない
    expect(text).toContain(
      "| 疲労 | 残業時間 | + | あり | 疲れると効率が落ち \\| 残業が増える |",
    );
    expect(text).toContain(
      "- R1（自己強化、遅れあり、確認済み）: 残業時間 → 疲労 → 残業時間",
    );
    expect(text).toContain(
      "- **応急処置の失敗**（R1）: 対処が副作用で問題を悪化させる構造",
    );
    expect(text).toContain("- テーマ: 残業が減らない");
    expect(text).toContain("- 時間挙動: increasing — 半年前から増加");
    expect(text).toContain("  - マネージャ: 納期 / 離職");
    expect(text).toContain("- 変数候補: 離職率（マネージャ）");
  });

  it("空の図でも節は落とさず空である旨を書く", () => {
    const text = exportDiagramToMarkdown({
      diagram: { nodes: [], edges: [] },
      loops: [],
    });
    expect(text).toContain("## 変数\n\n（まだ図はありません）");
    expect(text).toContain("## 因果リンク\n\n（まだありません）");
    expect(text).toContain("## ループ\n\n（まだ閉じたループはありません）");
    expect(text).toContain("## システム原型\n\n（該当なし）");
    expect(text).toContain("## 聞き取りノート\n\n（まだありません）");
  });

  it("ループ打ち切りを明示する", () => {
    const text = exportDiagramToMarkdown({ diagram, loops, truncated: true });
    expect(text).toContain("- …ループが多いため一部を省略");
  });
});

describe("renderDiagramExport", () => {
  const input = {
    title: "共有の問い",
    nodes: [
      { id: "a", name: "残業時間" },
      { id: "b", name: "疲労" },
    ],
    edges: [
      {
        id: "e1",
        sourceNodeId: "a",
        targetNodeId: "b",
        polarity: "+" as const,
        hasDelay: false,
        rationale: "a",
      },
      {
        id: "e2",
        sourceNodeId: "b",
        targetNodeId: "a",
        polarity: "-" as const,
        hasDelay: true,
        rationale: "b",
      },
    ],
  };

  it("ID 付きの行からループを導出して mermaid / markdown を描く", () => {
    const mermaid = renderDiagramExport("mermaid", input);
    expect(mermaid).toContain('n0 -- "+" --> n1');
    expect(mermaid).toContain('n1 -. "-" .-> n0');
    expect(mermaid).toContain(
      "%% B1（バランス、遅れあり）: 残業時間 → 疲労 → 残業時間",
    );

    const markdown = renderDiagramExport("markdown", input);
    expect(markdown.startsWith("# 共有の問い")).toBe(true);
    expect(markdown).toContain("| 疲労 | 残業時間 | - | あり | b |");
    expect(markdown).toContain("- B1（バランス、遅れあり）");
  });
});
