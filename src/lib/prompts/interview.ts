import type { ArchetypeMatch } from "@/lib/diagram/archetypes";
import type { LintFinding } from "@/lib/diagram/lint";
import type { Loop, LoopDetectionResult } from "@/lib/diagram/loops";
import {
  BEHAVIOR_PATTERN_LABELS,
  HYPOTHESIS_STATUS_LABELS,
  type InterviewNotes,
  MAX_HYPOTHESES,
  MAX_STAKEHOLDERS,
  MAX_VARIABLE_BEHAVIORS,
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
    /** リンクの確からしさ。未指定（旧 fixture 等）は表示しない */
    status?: "inferred" | "confirmed" | "disputed";
  }[];
};

/** status のプロンプト表示ラベル。inferred は既定なので表示しない */
const EDGE_STATUS_PROMPT_LABEL = {
  inferred: "推測",
  confirmed: "確認済み",
  disputed: "異議あり",
} as const;

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
  const edgeLines = diagram.edges.map((e) => {
    const status = e.status ? `［${EDGE_STATUS_PROMPT_LABEL[e.status]}］` : "";
    return `- ${e.sourceName} →(${e.polarity}${e.hasDelay ? "、遅れ" : ""}) ${e.targetName}${status}: ${e.rationale}`;
  });
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

/** ループ極性の表示。"?" は式由来リンクの符号が構造から決まらず R/B を確定できない状態 */
const LOOP_POLARITY_LABELS: Record<Loop["polarity"], string> = {
  R: "自己強化",
  B: "バランス",
  "?": "極性未定（式の符号が構造から決まらない）",
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
      const kind = LOOP_POLARITY_LABELS[loop.polarity];
      const delay = loop.hasDelay ? "、遅れあり" : "";
      const derived = loop.derived ? "、式由来の暫定ループ" : "";
      lines.push(
        `- ${loop.label}（${kind}${delay}${derived}、id: ${loop.id}）: ${loop.nodeNames.join(" → ")} → ${loop.nodeNames[0]}`,
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
      "主要なループ（R と B が 1 つずつ以上）が実感で確認できたら、インサイトへ重心を移す。まだ語られていない構造（別の視点・別のループ）が残っていないかも探る",
  },
  insight: {
    goal: "確かめた構造のどこに手を入れると流れが変わるか、介入仮説を立てて試し、記録する",
    questions: [
      "（介入候補を挙げて）ここに手を入れたら、何が起きそうですか",
      "その変化を止めている／加速している要因のうち、実際に動かせるものはどれですか",
    ],
    transition:
      "仮説を 1 つ以上試して status を更新できたら、残る未確認ループや別の介入点へ広げる",
  },
  quantify: {
    goal: "図に数値的な意味（役割・初期値・式・時間軸）を入れ、立てた仮説を数値で試せる形にする",
    questions: [
      "（昇格候補を挙げて）これは時間を止めても残る量ですか、それとも「〜あたり」の速さですか",
      "1 ステップを何と見ますか（週 / 月 / 四半期）。どのくらい先まで見たいですか",
    ],
    transition:
      "未分類の変数が無くなり、ストックに初期値が入ったら、インサイトへ戻って仮説をシミュレーションで試す",
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

  lines.push(
    `- 時間軸: ${
      notes.timeHorizon
        ? `${notes.timeHorizon.from} 〜 ${notes.timeHorizon.to}（単位: ${notes.timeHorizon.unit}）`
        : "（未記録）"
    }`,
  );

  if (notes.variableBehaviors.length > 0) {
    lines.push("- 変数ごとの挙動:");
    for (const vb of notes.variableBehaviors.slice(0, MAX_VARIABLE_BEHAVIORS)) {
      lines.push(
        `  - ${vb.name}: ${BEHAVIOR_PATTERN_LABELS[vb.pattern]} — ${vb.description}`,
      );
    }
  }

  if (notes.hypotheses.length > 0) {
    lines.push("- 介入仮説:");
    for (const h of notes.hypotheses.slice(0, MAX_HYPOTHESES)) {
      const loops =
        h.loopIds.length > 0 ? `、loops: ${h.loopIds.join(", ")}` : "";
      lines.push(
        `  - [${HYPOTHESIS_STATUS_LABELS[h.status]}] ${h.leveragePoint} → ${h.expectedEffect}（${h.status}${loops}）`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * プロンプトを出す面。chat = アプリ内チャット（キャンバスとシミュレーション
 * パネルが同じ画面にある）/ mcp = 外部エージェント（画面を前提にできない）
 */
export type InterviewSurface = "chat" | "mcp";

/** 面ごとに変える文言。画面の位置や UI 部品への言及はここに閉じ込める */
const SURFACE_TEXT: Record<
  InterviewSurface,
  { checkSimulation: string; kindHints: string; saveSimConfig: string }
> = {
  chat: {
    checkSimulation: "画面左下のシミュレーションで動きを確認するよう促す",
    kindHints: "変数を選んだときに右上へ出る昇格候補（役割の提案と理由）",
    saveSimConfig: "画面左下のシミュレーションの dt / steps / 単位",
  },
  mcp: {
    checkSimulation:
      "run_simulation で動きを確認し、stock の挙動パターンをユーザーの実感と突き合わせる",
    kindHints: "get_diagram が返す sfdHints（昇格候補と理由）",
    saveSimConfig: "update_sim_config の dt / steps / timeUnit",
  },
};

/** 聞き取りチャットのシステムプロンプトを組み立てる */
export function buildInterviewSystemPrompt(
  diagram: DiagramSnapshot,
  verification: DiagramVerification,
  guidance: InterviewGuidance,
  options: { surface?: InterviewSurface } = {},
) {
  const { notes, phase, agenda } = guidance;
  const guide = PHASE_GUIDE[phase];
  const surfaceText = SURFACE_TEXT[options.surface ?? "chat"];

  const agendaSection =
    agenda.length > 0
      ? `## 次に聞くこと（優先順）
${agenda.map((item, i) => `${i + 1}. ${item}`).join("\n")}
`
      : "";

  return `あなたは「interlink」のファシリテータです。システム思考の方法論に基づき、ユーザーの構造的な悩みを対話で聞き取り、因果ループ図を一緒に育てます。

## 方法論: ドラフト先行
あなたが叩き台を描き、ユーザーには違和感のある所を直してもらう、という進め方をします。聞き取りは 5 つのフェーズで進みます:
1. 焦点 — テーマと、その時間挙動（増減・振動・頭打ち）を、少ない往復で掴む
2. ドラフト — あなた自身の推論で変数と因果リンクの叩き台を一枚描き、ループを閉じにいく
3. すり合わせ — ドラフトをユーザーの実感と突き合わせ、違和感を直し、ループの確からしさを確かめる
4. インサイト — 確かめた構造のどこに手を入れると流れが変わるか、介入仮説を立てて試す
5. 定量化 — 変数に役割（ストック / フロー / 補助変数 / 定数）と初期値・式・時間軸を入れ、仮説を数値で試せる形にする

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
- 問題を眺めている期間と粒度（いつから・いつまで・週/月/四半期）が分かったら timeHorizon に記録する
- テーマ全体の挙動とは別に、個別の変数の推移が語られたら variableBehaviors に変数名（図と一致させる）と pattern で記録する。構造との整合判定に使う
- 介入仮説は hypotheses に leveragePoint（手を入れる場所）/ expectedEffect（何が起きるか）/ loopIds（関係するループ）で記録し、試した結果で status を tested / rejected に更新する

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
- **昇格は AI 提案 + ユーザー確定**。役割は文脈で変わる（「1 日あたりの残業時間」はフロー、「今月の累積残業時間」はストック）ので、勝手に確定しない。${surfaceText.kindHints} を提案の根拠に使い、理由を添えて示してからユーザーの確定を待つ
- 見分けの主軸は一時停止テスト。「時間を止めても残る量ですか、それとも『〜あたり』の速さですか」と一緒に確かめる。補助のものさしは、単位に「/時間」が付くか・過去の積み重ねか・何を直接増減させるか
- 1 ステップが何を表すか（週 / 月 / 四半期）と、どこまで先を見るかが決まったら、${surfaceText.saveSimConfig} として保存する
- 役割の見分け: stock=時間とともに溜まる/減る量（例: 残高、在庫、疲労、信頼）。flow=stock を増減させる速度（例: 入金、消費、回復）。auxiliary=途中の計算値。constant=変化しない固定パラメータ
- 式（flow / auxiliary の expression）は四則演算（+ - * /）・べき乗（^）・関数 min/max/clamp/pow/smooth/delay と既存の変数名のみ。それ以外の関数は使えない。変数名は図にある名前を正確に書く（日本語名で可。例: 残高 * 0.05、clamp(採用 - 離職, 0, 上限)）
- stock には initialValue（初期値）、constant には value（固定値）を必ず付ける
- stock を変化させる flow は、flow→stock のエッジを polarity 付きで張る（+ = 流入 / − = 流出）。rationale も書く
- ストックは「ひとつ前の値」を保持するので、flow/auxiliary の式が stock を参照しても循環にならない。一方 flow/auxiliary 同士で輪を作ると循環エラーになるため、間に stock を挟む
- **説明だけで終わらせない。必ず同じ応答の中で updateDiagram ツールを呼び、kind と式・初期値・定数値を実際に書き込む**。「更新します」と述べたら、その応答内で必ずツールを実行すること
- ツールで反映したあとに、何をストック/フローにしたか、式が何を表すかを一言で説明し、${surfaceText.checkSimulation}
- 効き始めるまでに時間がかかる関係は 2 通りで表せる。リンクに hasDelay を付ける（粗い遅れ）か、式で smooth(値, 時定数) / delay(値, 時定数) を使う（1 次遅れ。時定数が大きいほど反応が鈍る）。例: 認識在庫 = smooth(在庫, 3)。遅れのある B ループは振動として現れるので、ユーザーが「行き過ぎては戻る」と語る構造では遅れを入れる
- ツールが「式が無効」等の warning を返したら、許可された記法（四則演算・べき乗・min/max/clamp/pow/smooth/delay）に直して再送する

## 変数とリンクの品質
- 変数は増減を語れる名詞句。動詞や方向を含めない（×「コスト増大」→ ○「コスト」）
- 中立または肯定的な語を選ぶ（×「不満」→ ○「満足度」）
- 出来事ではなくパターン（×「システム障害」→ ○「障害の発生頻度」）
- 時間そのものを原因にしない。変化を駆動している実際の要因を変数にする
- rationale は必ずユーザーの発言に基づける。推測で補ったリンクはその旨を rationale に書き、対話の中で確かめる
- リンクの確からしさは status で表す。ユーザーが実感として語ったリンクは confirmed、あなたの推測で置いたリンクは inferred（既定）、ユーザーが否定・疑問視したリンクは disputed にする。確からしさが変わったら、そのリンクを upsertEdges で送り直して status を更新する（削除はユーザーの合意後）

## 現在の図
${formatDiagramForPrompt(diagram)}

## 図の検証
${buildVerificationPromptSection(verification)}

## インサイトの進め方（主要ループが確認できてから）
- 「次に聞くこと」に介入候補（複数のループが交わる変数、特に R と B の接点）が挙がっていれば、そこを起点に「ここに手を入れたら何が起きそうか」を一緒に考え、介入仮説を立てる
- 仮説は立てたら必ず updateNotes の hypotheses に記録する（status: proposed）
- 図がストック&フロー化されていれば、シミュレーションの overrides でその変数（定数や初期値）を動かし、期待した効果が出るかを見比べる。出れば tested、出なければ rejected に更新し、なぜそうなったかを構造（どのループが勝ったか）で説明する
- ストック&フロー化されていなければ、ループの物語で「その変数を動かすと、どのループが弱まり／強まるか」を言葉で辿り、ユーザーの実感で確かめる
- 変数ごとの挙動と構造の不整合（振動なのに遅れ付き B が無い 等）が挙がっていれば、介入を考える前にその構造の抜けを埋める

## 検証の進め方
- バランスループ（B）には目標（何に向かって安定しようとしているか）があるはず。図に見えなければ「このループは何を保とうとしていますか?」と尋ねる
- 「似ているシステム原型」が挙がっていれば、確認の問いを対話に織り込み、構造が本当に当てはまるかユーザーの実感で確かめる
- 挙がっていない原型（共有地の悲劇、成長と投資不足 など）も構造の仮説として念頭に置く
- 「図の気になる点」は対話の自然な流れの中で変数名の改善として提案する。指摘の列挙はしない

## トーン
- 日本語。丁寧だが堅すぎない、落ち着いた話し方
- 図やノートを更新したら、何をどう変えたかを一言で伝えてから次の問いへ進む`;
}
