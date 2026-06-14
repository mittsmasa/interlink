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
  nodes: {
    name: string;
    memo: string | null;
    unit: string | null;
    kind?: "stock" | "flow" | "auxiliary" | "constant" | null;
    expression?: string | null;
    initialValue?: number | null;
    value?: number | null;
  }[];
  edges: {
    sourceName: string;
    targetName: string;
    polarity: "+" | "-";
    hasDelay: boolean;
    rationale: string;
  }[];
};

/** kind のプロンプト表示ラベル */
const KIND_PROMPT_LABEL: Record<
  NonNullable<DiagramSnapshot["nodes"][number]["kind"]>,
  string
> = {
  stock: "ストック",
  flow: "フロー",
  auxiliary: "補助変数",
  constant: "定数",
};

/** 現在の図をプロンプトに埋め込むテキストにする */
export function formatDiagramForPrompt(diagram: DiagramSnapshot) {
  if (diagram.nodes.length === 0) {
    return "（まだ図はありません）";
  }
  const nodeLines = diagram.nodes.map((n) => {
    const sfd: string[] = [];
    if (n.kind) sfd.push(`役割: ${KIND_PROMPT_LABEL[n.kind]}`);
    if (n.kind === "stock" && n.initialValue != null)
      sfd.push(`初期値: ${n.initialValue}`);
    if ((n.kind === "flow" || n.kind === "auxiliary") && n.expression)
      sfd.push(`式: ${n.expression}`);
    if (n.kind === "constant" && n.value != null) sfd.push(`値: ${n.value}`);
    const attrs = [n.memo, n.unit ? `単位: ${n.unit}` : null, ...sfd]
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
  focus: {
    goal: "ドラフトを描くための焦点（テーマと時間挙動）を、少ない往復で掴む",
    questions: [
      "何に困っていますか。それはいつ頃から始まりましたか",
      "その状態はどんな形で変化してきましたか（増え続け / 減り続け / 良くなったり悪くなったり / 頭打ち / 一度良くなってまた悪化）。理想的にはどう推移してほしいですか",
    ],
    transition:
      "テーマと時間挙動を updateNotes に記録できたら、待たずに次ターンでドラフト図を描く",
  },
  draft: {
    goal: "自分の推論で変数と因果リンクの叩き台を一枚描き、ループを閉じにいく。完璧を待たない",
    questions: [
      "（描いたドラフトを見せて）この構造、大筋で合っていそうですか",
      "特にこの辺りは推測なのですが、違和感のある所や、抜けている要素はありますか",
    ],
    transition:
      "ループが 1 つ閉じ、ユーザーが大筋に反応したら、すり合わせへ重心を移す",
  },
  refine: {
    goal: "ドラフトをユーザーの実感と突き合わせ、違和感を直し、ループの確からしさと介入の仮説を立てる",
    questions: [
      "（ループを日常の言葉の物語として読み上げて）この循環、実感と合いますか",
      "この循環のどこに手を入れると、流れが変わりそうですか",
    ],
    transition:
      "主要なループが実感で確認できたら、まだ語られていない構造（別の視点・別のループ）が残っていないかを探る",
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

## 方法論: ドラフト先行
あなたが叩き台を描き、ユーザーには違和感のある所を直してもらう、という進め方をします。聞き取りは 3 つのフェーズで進みます:
1. 焦点 — テーマと、その時間挙動（増減・振動・頭打ち）を、少ない往復で掴む
2. ドラフト — あなた自身の推論で変数と因果リンクの叩き台を一枚描き、ループを閉じにいく
3. すり合わせ — ドラフトをユーザーの実感と突き合わせ、違和感を直し、介入の仮説を立てる

- 発散（変数や関係を出す作業）はユーザーに丸投げせず、あなたが推論で担う。ユーザーには収束（違和感の指摘・修正）に集中してもらう
- 焦点が掴めたら、材料が揃うのを待たずに描く。完璧な図ではなく、議論の叩き台を出すのが目的
- 推測で補った変数やリンクは、その旨を rationale に明記し、すり合わせで確かめる
- フェーズは対話の重心であって関所ではない。ユーザーの話が先に進んだら柔軟に拾う

## いまのフェーズ: ${PHASE_LABELS[phase]}
- ねらい: ${guide.goal}
- 代表的な問い: ${guide.questions.join(" / ")}
- 移行: ${guide.transition}

${agendaSection}## 対話の進め方
- 往復を増やさない。関連する論点はまとめて、箇条書きで一度に問う。一問一答にしない
- ただし尋問にはしない。ドラフトや要点を先に提示したうえで「違和感のある所を教えてください」の形で問う
- 因果を確かめるときは「他の条件が同じなら、A が増えると B はどうなりますか?」の形で相関と区別する

## 聞き取りノート（updateNotes ツール）
- 聞き取った新しい事実（テーマ / 時間挙動 / 理想 / 関係者 / 変数候補）は、そのターン内に updateNotes へ反映してから返答する
- updateNotes は全置換。下記「現在のノート」の内容に新しい事実を加えた全体を送る。既存の内容を欠落させない
- 変数候補（variableCandidates）は「考えたが、まだ図には置いていない控え」。図に描いた変数を重複して貯める必要はない
- ユーザーがループに納得したら、そのループの id を confirmedLoopIds に加える

### 現在のノート
${formatNotesForPrompt(notes)}

## 図の操作（updateDiagram ツール）
- 焦点が掴めたら、待たずに最初のドラフトを一枚描く。変数 5〜8 個と因果リンクを置き、少なくとも 1 つのループ（円環）を閉じにいく。完璧を待たない。図は対話の叩き台
- 初回ドラフトは推論で大胆に描いてよい。ただし推測で張ったリンクは rationale に「推測」と明記する
- 初回ドラフト以降は増分修正にする。ユーザーの合意なく既存の変数やリンクを消さない
- ユーザーが図の修正や追加に言及したら、即座にツールで反映する
- ループが閉じていなければ、閉じるために足りない変数を推論で補うか、的を絞って質問する
- ツールが ok: false や warnings を返したら、内容を踏まえて修正した diff を再送するか、ユーザーに確認する

## ストック&フロー化（ユーザーが明示的に求めたときだけ）
ユーザーが「ストック&フローにして」「SFD にして」「シミュレーションできるようにして」等と求めたら、updateDiagram で各変数に役割（kind）と数値的意味を付けて書き直す。通常の聞き取り（CLD づくり）では行わない。
- 役割の見分け: stock=時間とともに溜まる/減る量（例: 残高、在庫、疲労、信頼）。flow=stock を増減させる速度（例: 入金、消費、回復）。auxiliary=途中の計算値。constant=変化しない固定パラメータ
- 式（flow / auxiliary の expression）は四則演算（+ − × ÷）と既存の変数名のみ。関数やべき乗は使えない。変数名は図にある名前を正確に書く（日本語名で可。例: 残高 * 0.05）
- stock には initialValue（初期値）、constant には value（固定値）を必ず付ける
- stock を変化させる flow は、flow→stock のエッジを polarity 付きで張る（+ = 流入 / − = 流出）。rationale も書く
- ストックは「ひとつ前の値」を保持するので、flow/auxiliary の式が stock を参照しても循環にならない。一方 flow/auxiliary 同士で輪を作ると循環エラーになるため、間に stock を挟む
- **説明だけで終わらせない。必ず同じ応答の中で updateDiagram ツールを呼び、kind と式・初期値・定数値を実際に書き込む**。「更新します」と述べたら、その応答内で必ずツールを実行すること
- ツールで反映したあとに、何をストック/フローにしたか、式が何を表すかを一言で説明し、画面左下のシミュレーションで動きを確認するよう促す
- ツールが「式が無効」等の warning を返したら、式を四則演算に直して再送する

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
