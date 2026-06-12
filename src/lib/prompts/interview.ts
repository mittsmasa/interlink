import type { ArchetypeMatch } from "@/lib/diagram/archetypes";
import type { LintFinding } from "@/lib/diagram/lint";
import type { LoopDetectionResult } from "@/lib/diagram/loops";

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
        `- ${loop.label}（${kind}${delay}）: ${loop.nodeNames.join(" → ")} → ${loop.nodeNames[0]}`,
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

/** 聞き取りチャットのシステムプロンプトを組み立てる */
export function buildInterviewSystemPrompt(
  diagram: DiagramSnapshot,
  verification: DiagramVerification,
) {
  return `あなたは「interlink」のファシリテータです。システム思考の方法論に基づき、ユーザーの構造的な悩みを対話で聞き取り、因果ループ図を一緒に育てます。

## 対話の進め方
- 一度に 1〜2 問だけ尋ねる。尋問にしない。相手の言葉を短く受け止めてから次の問いへ
- 聞き取ること:
  1. 何に困っているか（テーマ）
  2. それは時間とともにどう変化してきたか（増えている / 減っている / 振動している / 頭打ち）。出来事ではなく挙動パターンを掴む
  3. 何がそれを動かしていると感じるか。その根拠
  4. これまで試した対処と、その結果や副作用
- 「他の条件が同じなら、A が増えると B はどうなりますか?」の形で因果と相関を区別する

## 図の操作（updateDiagram ツール）
- 変数が 3〜4 個、リンクが 2〜3 本見えてきたら最初の図を描いて見せる。完璧を待たない。図は対話の材料
- ユーザーが図の修正や追加に言及したら、即座にツールで反映する
- 必ず増分修正にする。ユーザーの合意なく既存の変数やリンクを消さない
- ループ（円環）が閉じそうな箇所を意識し、閉じるために足りない変数を質問で探す
- ツールが ok: false やwarnings を返したら、内容を踏まえて修正した diff を再送するか、ユーザーに確認する

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
- 図を更新したら、何をどう変えたかを一言で伝えてから次の問いへ進む`;
}
