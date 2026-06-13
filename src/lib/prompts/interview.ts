import type { ArchetypeMatch } from "@/lib/diagram/archetypes";
import type { LintFinding } from "@/lib/diagram/lint";
import type { LoopDetectionResult } from "@/lib/diagram/loops";
import {
  BEHAVIOR_PATTERN_LABELS,
  type InterviewNotes,
  MAX_STAKEHOLDERS,
  MAX_VARIABLE_CANDIDATES,
} from "@/lib/interview/notes";
import { type InterviewPhase, PHASE_LABELS } from "@/lib/interview/phase";

type DiagramSnapshot = {
  nodes: { name: string; memo: string | null; unit: string | null }[];
  edges: {
    sourceName: string;
    targetName: string;
    polarity: "+" | "-";
    hasDelay: boolean;
    rationale: string;
  }[];
};

/** 現在の図をプロンプトに埋め込むテキストにする */
export function formatDiagramForPrompt(diagram: DiagramSnapshot) {
  if (diagram.nodes.length === 0) {
    return "（まだ図はありません）";
  }
  const nodeLines = diagram.nodes.map((n) => {
    const attrs = [n.memo, n.unit ? `単位: ${n.unit}` : null]
      .filter(Boolean)
      .join(" / ");
    return `- ${n.name}${attrs ? `（${attrs}）` : ""}`;
  });
  const edgeLines = diagram.edges.map(
    (e) =>
      `- ${e.sourceName} →(${e.polarity}${e.hasDelay ? "、遅れ" : ""}) ${e.targetName}: ${e.rationale}`,
  );
  return [
    "### 変数",
    ...nodeLines,
    "",
    "### 因果リンク",
    ...(edgeLines.length > 0 ? edgeLines : ["（まだありません）"]),
  ].join("\n");
}

export type DiagramVerification = {
  loopResult: LoopDetectionResult;
  findings: LintFinding[];
  matches: ArchetypeMatch[];
};

/** プロンプトに埋め込むループ数の上限 */
const PROMPT_MAX_LOOPS = 10;
/** プロンプトに埋め込む lint 指摘数の上限 */
const PROMPT_MAX_FINDINGS = 5;

/**
 * 図の検証結果（ループ / lint / 原型）をプロンプト用の要約テキストにする。
 * トークン肥大を避けるため件数を制限し、空の節は出さない。
 */
export function buildVerificationPromptSection(
  verification: DiagramVerification,
): string {
  const { loopResult, findings, matches } = verification;
  const lines: string[] = ["### 現在のループ"];

  if (loopResult.loops.length === 0) {
    lines.push(
      "（まだ閉じたループはありません。閉じそうな円環を意識し、足りない変数を質問で探してください）",
    );
  } else {
    const shown = loopResult.loops.slice(0, PROMPT_MAX_LOOPS);
    for (const loop of shown) {
      const kind = loop.polarity === "R" ? "自己強化" : "バランス";
      const delay = loop.hasDelay ? "、遅れあり" : "";
      lines.push(
        `- ${loop.label}（${kind}${delay}、id: ${loop.id}）: ${loop.nodeNames.join(" → ")} → ${loop.nodeNames[0]}`,
      );
    }
    const hiddenCount = loopResult.loops.length - shown.length;
    if (hiddenCount > 0 || loopResult.truncated) {
      lines.push(`- …ほかにもループがあります（${hiddenCount} 件以上省略）`);
    }
  }

  if (findings.length > 0) {
    lines.push("", "### 図の気になる点");
    for (const finding of findings.slice(0, PROMPT_MAX_FINDINGS)) {
      lines.push(`- ${finding.message}`);
    }
    const hiddenCount = findings.length - PROMPT_MAX_FINDINGS;
    if (hiddenCount > 0) {
      lines.push(`- …ほか ${hiddenCount} 件`);
    }
  }

  if (matches.length > 0) {
    lines.push("", "### 似ているシステム原型");
    for (const match of matches) {
      lines.push(
        `- 「${match.name}」（${match.description}）。確認の問いの例: ${match.question}`,
      );
    }
  }

  return lines.join("\n");
}

/** 聞き取りの誘導情報。サーバ側でノートと図から決定的に導出する */
export type InterviewGuidance = {
  notes: InterviewNotes;
  phase: InterviewPhase;
  agenda: string[];
};

/** フェーズごとの誘導内容（ねらい / 代表的な問い / 移行条件） */
const PHASE_GUIDE: Record<
  InterviewPhase,
  { goal: string; questions: string[]; transition: string }
> = {
  "time-axis": {
    goal: "問題を出来事ではなく、時間とともに変化する挙動として掴む",
    questions: [
      "何に困っていますか。それはいつ頃から始まりましたか",
      "その状態は、どんな形で変化してきましたか（増え続けている / 減り続けている / 良くなったり悪くなったり / 頭打ち / 一度良くなってまた悪化）",
      "理想的には、どう推移してほしいですか",
    ],
    transition:
      "テーマと時間挙動を updateNotes に記録できたら、関係者分析へ重心を移す",
  },
  stakeholders: {
    goal: "変数の供給源になる関係者と、それぞれの関心事を広げる",
    questions: [
      "この問題に関わっているのは誰ですか（人・チーム・組織）",
      "その人は何を望んでいて、何を恐れていますか",
      "互いにぶつかっている関心はありませんか",
    ],
    transition:
      "関係者と関心事が複数記録できたら、変数抽出へ重心を移す。関心の対立はループの種なので見逃さない",
  },
  variables: {
    goal: "関心事を「増減を語れる変数」に変換し、候補プールを広げる。まだ図に置かない",
    questions: [
      "その関心事は、何が増えたり減ったりする話ですか",
      "テーマの変数を動かしていそうなものは何ですか。逆に、テーマの変数が動かしているものは?",
    ],
    transition:
      "候補が 8 個ほど揃ったら因果分析へ。候補は updateNotes の variableCandidates に貯める",
  },
  causality: {
    goal: "候補から効きそうな変数を選び、因果リンクを張り、ループを閉じる。updateDiagram の本格稼働はここから",
    questions: [
      "他の条件が同じなら、A が増えると B はどうなりますか",
      "その影響はすぐ現れますか。それとも遅れて現れますか",
    ],
    transition: "ループが 1 つ閉じたら、仮説の検証へ重心を移す",
  },
  hypothesis: {
    goal: "閉じたループをユーザーの実感と突き合わせ、構造の確からしさと介入の仮説を立てる",
    questions: [
      "（ループを日常の言葉の物語として読み上げて）この循環、実感と合いますか",
      "この循環のどこに手を入れると、流れが変わりそうですか",
    ],
    transition:
      "主要なループが実感で確認できたら、まだ語られていない構造（別の関係者の視点など）が残っていないかを探る",
  },
};

/** 聞き取りノートをプロンプト用テキストにする */
export function formatNotesForPrompt(notes: InterviewNotes): string {
  const lines: string[] = [];
  lines.push(`- テーマ: ${notes.theme ?? "（未記録）"}`);
  lines.push(
    `- 時間挙動: ${
      notes.behavior
        ? `${BEHAVIOR_PATTERN_LABELS[notes.behavior.pattern]} — ${notes.behavior.description}`
        : "（未記録）"
    }`,
  );
  lines.push(`- 理想の挙動: ${notes.idealBehavior ?? "（未記録）"}`);

  if (notes.stakeholders.length === 0) {
    lines.push("- 関係者: （未記録）");
  } else {
    lines.push("- 関係者:");
    for (const s of notes.stakeholders.slice(0, MAX_STAKEHOLDERS)) {
      const concerns =
        s.concerns.length > 0 ? `: ${s.concerns.join(" / ")}` : "";
      lines.push(`  - ${s.name}${concerns}`);
    }
  }

  if (notes.variableCandidates.length === 0) {
    lines.push("- 変数候補: （未記録）");
  } else {
    lines.push("- 変数候補（図に置く前の材料）:");
    for (const c of notes.variableCandidates.slice(
      0,
      MAX_VARIABLE_CANDIDATES,
    )) {
      lines.push(`  - ${c.name}${c.source ? `（出所: ${c.source}）` : ""}`);
    }
  }

  lines.push(
    `- 確認済みループ ID: ${
      notes.confirmedLoopIds.length > 0
        ? notes.confirmedLoopIds.join(", ")
        : "（なし）"
    }`,
  );
  return lines.join("\n");
}

/** 聞き取りチャットのシステムプロンプトを組み立てる */
export function buildInterviewSystemPrompt(
  diagram: DiagramSnapshot,
  verification: DiagramVerification,
  guidance: InterviewGuidance,
) {
  const { notes, phase, agenda } = guidance;
  const guide = PHASE_GUIDE[phase];

  const agendaSection =
    agenda.length > 0
      ? `## 次に聞くこと（優先順）
${agenda.map((item, i) => `${i + 1}. ${item}`).join("\n")}
`
      : "";

  return `あなたは「interlink」のファシリテータです。システム思考の方法論に基づき、ユーザーの構造的な悩みを対話で聞き取り、因果ループ図を一緒に育てます。

## 方法論: 発散から集約へ
聞き取りは 5 つのフェーズで進めます:
1. 時間軸分析 — テーマと、その時間挙動（増減・振動・頭打ち）を掴む
2. 関係者分析 — 関わる人と関心事を広げる
3. 変数抽出 — 関心事を変数候補に変換して貯める
4. 因果分析 — 変数を選び、リンクを張り、ループを閉じる
5. 仮説の検証 — ループを実感と突き合わせ、介入の仮説を立てる

- フェーズ 1〜3 は発散。updateDiagram を急がず、材料は updateNotes の variableCandidates に貯める
- フェーズ 4 から集約。候補の中から効きそうな変数を選んで図化する
- フェーズは対話の重心であって、関所ではない。ユーザーの話が先のフェーズに及んだら柔軟に拾ってノートに記録し、そのうえで重心に戻る

## いまのフェーズ: ${PHASE_LABELS[phase]}
- ねらい: ${guide.goal}
- 代表的な問い: ${guide.questions.join(" / ")}
- 移行: ${guide.transition}

${agendaSection}## 対話の進め方
- 一度に 1〜2 問だけ尋ねる。尋問にしない。相手の言葉を短く受け止めてから次の問いへ
- 「他の条件が同じなら、A が増えると B はどうなりますか?」の形で因果と相関を区別する

## 聞き取りノート（updateNotes ツール）
- 聞き取った新しい事実（テーマ / 時間挙動 / 理想 / 関係者 / 変数候補）は、そのターン内に updateNotes へ反映してから返答する
- updateNotes は全置換。下記「現在のノート」の内容に新しい事実を加えた全体を送る。既存の内容を欠落させない
- ユーザーがループに納得したら、そのループの id を confirmedLoopIds に加える

### 現在のノート
${formatNotesForPrompt(notes)}

## 図の操作（updateDiagram ツール）
- 因果分析フェーズに入ったら、変数候補から 3〜4 個を選んで最初の図を描いて見せる。完璧を待たない。図は対話の材料
- ユーザーが図の修正や追加に言及したら、即座にツールで反映する
- 必ず増分修正にする。ユーザーの合意なく既存の変数やリンクを消さない
- ループ（円環）が閉じそうな箇所を意識し、閉じるために足りない変数を質問で探す
- ツールが ok: false や warnings を返したら、内容を踏まえて修正した diff を再送するか、ユーザーに確認する

## 変数とリンクの品質
- 変数は増減を語れる名詞句。動詞や方向を含めない（×「コスト増大」→ ○「コスト」）
- 中立または肯定的な語を選ぶ（×「不満」→ ○「満足度」）
- 出来事ではなくパターン（×「システム障害」→ ○「障害の発生頻度」）
- 時間そのものを原因にしない。変化を駆動している実際の要因を変数にする
- rationale は必ずユーザーの発言に基づける。推測で補ったリンクはその旨を rationale に書き、対話の中で確かめる

## 現在の図
${formatDiagramForPrompt(diagram)}

## 図の検証
${buildVerificationPromptSection(verification)}

## 検証の進め方
- バランスループ（B）には目標（何に向かって安定しようとしているか）があるはず。図に見えなければ「このループは何を保とうとしていますか?」と尋ねる
- 「似ているシステム原型」が挙がっていれば、確認の問いを対話に織り込み、構造が本当に当てはまるかユーザーの実感で確かめる
- 挙がっていない原型（共有地の悲劇、成長と投資不足 など）も構造の仮説として念頭に置く
- 「図の気になる点」は対話の自然な流れの中で変数名の改善として提案する。指摘の列挙はしない

## トーン
- 日本語。丁寧だが堅すぎない、落ち着いた話し方
- 図やノートを更新したら、何をどう変えたかを一言で伝えてから次の問いへ進む`;
}
