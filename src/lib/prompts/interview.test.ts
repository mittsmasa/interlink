import { describe, expect, it } from "vitest";
import type { Loop } from "@/lib/diagram/loops";
import { emptyInterviewNotes } from "@/lib/interview/notes";
import {
  buildInterviewSystemPrompt,
  buildVerificationPromptSection,
  type DiagramVerification,
  formatNotesForPrompt,
  type InterviewGuidance,
} from "./interview";

const loop = (n: number, polarity: Loop["polarity"] = "R"): Loop => ({
  id: `loop:${n}`,
  label: `${polarity}${n}`,
  nodeIds: [`a${n}`, `b${n}`],
  nodeNames: [`変数A${n}`, `変数B${n}`],
  edgeIds: [`e${n}-1`, `e${n}-2`],
  polarity,
  hasDelay: false,
});

const emptyVerification: DiagramVerification = {
  loopResult: { loops: [], truncated: false },
  findings: [],
  matches: [],
};

describe("buildVerificationPromptSection", () => {
  it("ループがなければその旨を伝える", () => {
    const text = buildVerificationPromptSection(emptyVerification);
    expect(text).toContain("まだ閉じたループはありません");
    expect(text).not.toContain("気になる点");
    expect(text).not.toContain("似ているシステム原型");
  });

  it("ループは上位 10 件に制限され、省略件数が示される", () => {
    const loops = Array.from({ length: 12 }, (_, i) => loop(i + 1));
    const text = buildVerificationPromptSection({
      ...emptyVerification,
      loopResult: { loops, truncated: false },
    });
    expect(text).toContain(
      "R1（自己強化、id: loop:1）: 変数A1 → 変数B1 → 変数A1",
    );
    expect(text).toContain("R10");
    expect(text).not.toContain("R11");
    expect(text).toContain("2 件以上省略");
  });

  it("極性は R / B / ? で三値に表示され、? は極性未定と注記される", () => {
    const text = buildVerificationPromptSection({
      ...emptyVerification,
      loopResult: {
        loops: [loop(1, "R"), loop(2, "B"), loop(3, "?")],
        truncated: false,
      },
    });
    expect(text).toContain("R1（自己強化、id: loop:1）");
    expect(text).toContain("B2（バランス、id: loop:2）");
    expect(text).toContain(
      "?3（極性未定（式の符号が構造から決まらない）、id: loop:3）",
    );
  });

  it("式由来の暫定ループにはその旨を注記する", () => {
    const text = buildVerificationPromptSection({
      ...emptyVerification,
      loopResult: {
        loops: [{ ...loop(1, "R"), derived: true }, loop(2, "B")],
        truncated: false,
      },
    });
    expect(text).toContain("R1（自己強化、式由来の暫定ループ、id: loop:1）");
    expect(text).toContain("B2（バランス、id: loop:2）");
  });

  it("lint 指摘は上位 5 件に制限される", () => {
    const findings = Array.from({ length: 7 }, (_, i) => ({
      rule: "isolated-node" as const,
      severity: "info" as const,
      message: `指摘その${i + 1}`,
      nodeIds: [`n${i}`],
    }));
    const text = buildVerificationPromptSection({
      ...emptyVerification,
      findings,
    });
    expect(text).toContain("指摘その5");
    expect(text).not.toContain("指摘その6");
    expect(text).toContain("…ほか 2 件");
  });

  it("一致原型がなければ「似ているシステム原型」の節を出さない", () => {
    const text = buildVerificationPromptSection({
      ...emptyVerification,
      loopResult: { loops: [loop(1)], truncated: false },
    });
    expect(text).not.toContain("似ているシステム原型");
  });

  it("一致原型があれば名前と確認の問いを含む", () => {
    const text = buildVerificationPromptSection({
      ...emptyVerification,
      matches: [
        {
          archetypeId: "limits-to-growth",
          name: "成功の限界",
          description:
            "成長の自己強化ループを、制約のバランスループが抑える構造",
          question:
            "R1 の成長を B1 が抑えているなら、制約になっているものは何でしょう?",
          loopIds: ["loop:1", "loop:2"],
        },
      ],
    });
    expect(text).toContain("「成功の限界」");
    expect(text).toContain("制約になっているもの");
  });
});

const emptyGuidance: InterviewGuidance = {
  notes: emptyInterviewNotes(),
  phase: "focus",
  agenda: [],
};

describe("buildInterviewSystemPrompt", () => {
  it("検証セクションと検証の進め方を含む", () => {
    const prompt = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      emptyGuidance,
    );
    expect(prompt).toContain("## 図の検証");
    expect(prompt).toContain("## 検証の進め方");
    expect(prompt).toContain("### 現在のループ");
  });

  it("方法論と現在フェーズの節を含む", () => {
    const prompt = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      emptyGuidance,
    );
    expect(prompt).toContain("## 方法論: ドラフト先行");
    expect(prompt).toContain("## いまのフェーズ: 焦点");
    expect(prompt).toContain("あなたが叩き台を描き");
  });

  it("一括質問を促し、旧来の一問一答ルールは含まない", () => {
    const prompt = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      emptyGuidance,
    );
    expect(prompt).toContain("まとめて、箇条書きで一度に問う");
    expect(prompt).not.toContain("一度に 1〜2 問だけ");
  });

  it("フェーズに応じた誘導が変わる", () => {
    const prompt = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      { ...emptyGuidance, phase: "refine" },
    );
    expect(prompt).toContain("## いまのフェーズ: すり合わせ");
    expect(prompt).toContain("実感と合いますか");
  });

  it("インサイトフェーズでは介入仮説の進め方を含む", () => {
    const prompt = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      { ...emptyGuidance, phase: "insight" },
    );
    expect(prompt).toContain("## いまのフェーズ: インサイト");
    expect(prompt).toContain("4. インサイト");
    expect(prompt).toContain("## インサイトの進め方");
    expect(prompt).toContain("hypotheses");
  });

  it("アジェンダがあれば優先順で並び、なければ節ごと出さない", () => {
    const withAgenda = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      { ...emptyGuidance, agenda: ["最初の指示", "次の指示"] },
    );
    expect(withAgenda).toContain("## 次に聞くこと（優先順）");
    expect(withAgenda).toContain("1. 最初の指示");
    expect(withAgenda).toContain("2. 次の指示");

    const without = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      emptyGuidance,
    );
    expect(without).not.toContain("## 次に聞くこと");
  });

  it("現在のノートが埋め込まれる", () => {
    const prompt = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      {
        ...emptyGuidance,
        notes: {
          ...emptyInterviewNotes(),
          theme: "残業が減らない",
          confirmedLoopIds: ["loop:a→b"],
        },
      },
    );
    expect(prompt).toContain("### 現在のノート");
    expect(prompt).toContain("- テーマ: 残業が減らない");
    expect(prompt).toContain("確認済みループ ID: loop:a→b");
  });
});

describe("formatNotesForPrompt", () => {
  it("空ノートは各項目が未記録と示される", () => {
    const text = formatNotesForPrompt(emptyInterviewNotes());
    expect(text).toContain("- テーマ: （未記録）");
    expect(text).toContain("- 時間挙動: （未記録）");
    expect(text).toContain("- 変数候補: （未記録）");
  });

  it("記入済みノートはパターンの日本語ラベルと一覧を含む", () => {
    const text = formatNotesForPrompt({
      theme: "残業が減らない",
      behavior: { pattern: "increasing", description: "半年前から悪化" },
      idealBehavior: "横ばい",
      stakeholders: [{ name: "上司", concerns: ["納期を守りたい"] }],
      variableCandidates: [{ name: "残業時間", source: "自分" }],
      confirmedLoopIds: [],
      timeHorizon: null,
      variableBehaviors: [],
      hypotheses: [],
    });
    expect(text).toContain("増え続けている — 半年前から悪化");
    expect(text).toContain("- 上司: 納期を守りたい");
    expect(text).toContain("- 残業時間（出所: 自分）");
    expect(text).toContain("- 時間軸: （未記録）");
    expect(text).not.toContain("介入仮説");
  });

  it("時間軸・変数ごとの挙動・介入仮説が記入されていれば一覧に出る", () => {
    const text = formatNotesForPrompt({
      ...emptyInterviewNotes(),
      timeHorizon: { from: "半年前", to: "現在", unit: "月" },
      variableBehaviors: [
        { name: "疲労", pattern: "oscillating", description: "波がある" },
      ],
      hypotheses: [
        {
          leveragePoint: "休息",
          expectedEffect: "疲労の波が収まる",
          loopIds: ["loop:b→d"],
          status: "tested",
        },
      ],
    });
    expect(text).toContain("- 時間軸: 半年前 〜 現在（単位: 月）");
    expect(text).toContain("  - 疲労: 振動している — 波がある");
    expect(text).toContain(
      "  - [検証済み] 休息 → 疲労の波が収まる（tested、loops: loop:b→d）",
    );
  });

  it("surface で UI 参照の文言を切り替える（既定は chat）", () => {
    const chat = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      emptyGuidance,
    );
    expect(chat).toContain("画面左下のシミュレーション");

    const mcp = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      emptyGuidance,
      { surface: "mcp" },
    );
    expect(mcp).not.toContain("画面左下");
    expect(mcp).toContain("run_simulation で動きを確認");
  });

  it("昇格候補の参照先と設定の保存先も面で切り替える", () => {
    const chat = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      emptyGuidance,
    );
    expect(chat).toContain("昇格は AI 提案 + ユーザー確定");
    expect(chat).toContain("変数を選んだときに右上へ出る昇格候補");
    expect(chat).not.toContain("sfdHints");

    const mcp = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      emptyGuidance,
      { surface: "mcp" },
    );
    expect(mcp).toContain("sfdHints");
    expect(mcp).toContain("update_sim_config");
  });

  it("定量化フェーズでは一時停止テストと時間軸の問いを誘導する", () => {
    const prompt = buildInterviewSystemPrompt(
      { nodes: [], edges: [] },
      emptyVerification,
      { ...emptyGuidance, phase: "quantify" },
    );
    expect(prompt).toContain("いまのフェーズ: 定量化");
    expect(prompt).toContain("時間を止めても残る量ですか");
    expect(prompt).toContain("1 ステップを何と見ますか");
    // 5 フェーズの説明に定量化が並ぶ
    expect(prompt).toContain("聞き取りは 5 つのフェーズで進みます");
  });
});
