import { type ArchetypeMatch, matchArchetypes } from "./archetypes";
import { buildLoopEdges } from "./loop-edges";
import { detectLoops, type Loop } from "./loops";

/**
 * 図の持ち出し（export_diagram / resources）用のテキスト生成。
 * DB に触らない純粋関数。格納はせず、呼び出し側がそのまま返す
 */

export type ExportNodeKind = "stock" | "flow" | "auxiliary" | "constant";

export type ExportDiagram = {
  nodes: {
    name: string;
    memo?: string | null;
    unit?: string | null;
    kind?: ExportNodeKind | null;
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

/** markdown に載せる聞き取りノートの要約。notes.ts の InterviewNotes と構造互換 */
export type ExportNotes = {
  theme: string | null;
  behavior: { pattern: string; description: string } | null;
  idealBehavior: string | null;
  stakeholders: { name: string; concerns: string[] }[];
  variableCandidates: { name: string; source: string | null }[];
  confirmedLoopIds: string[];
};

const KIND_LABEL: Record<ExportNodeKind, string> = {
  stock: "ストック",
  flow: "フロー",
  auxiliary: "補助変数",
  constant: "定数",
};

const POLARITY_LABEL: Record<Loop["polarity"], string> = {
  R: "自己強化",
  B: "バランス",
  "?": "極性不定",
};

/** mermaid のラベル文字列。ダブルクォートで包むので `"` だけ実体参照にする */
function mermaidLabel(text: string) {
  return `"${text.replaceAll('"', "#quot;")}"`;
}

/**
 * kind をノード形状で表す。
 * stock = 円柱 [( )]（蓄積）、flow = 平行四辺形 [/ /]（流れ）、
 * auxiliary = 角丸 ( )、constant = 六角形 {{ }}、未分類 = 四角 [ ]
 */
function mermaidNode(id: string, name: string, kind: ExportNodeKind | null) {
  const label = mermaidLabel(name);
  switch (kind) {
    case "stock":
      return `${id}[(${label})]`;
    case "flow":
      return `${id}[/${label}/]`;
    case "auxiliary":
      return `${id}(${label})`;
    case "constant":
      return `${id}{{${label}}}`;
    default:
      return `${id}[${label}]`;
  }
}

/** ループの一巡をテキストにする（始点へ戻る分まで書く） */
function loopPath(loop: Loop) {
  return `${loop.nodeNames.join(" → ")} → ${loop.nodeNames[0]}`;
}

/**
 * mermaid（graph LR）。極性をエッジラベル、遅れを点線、kind をノード形状で表し、
 * 末尾にループ一覧をコメントで添える。claude.ai などでそのまま描画できる
 */
export function exportDiagramToMermaid(
  diagram: ExportDiagram,
  loops: readonly Loop[],
): string {
  const lines = ["graph LR"];
  if (diagram.nodes.length === 0) {
    lines.push("  %% （まだ図はありません）");
    return lines.join("\n");
  }
  const idByName = new Map(diagram.nodes.map((n, i) => [n.name, `n${i}`]));
  for (const node of diagram.nodes) {
    const id = idByName.get(node.name) ?? "";
    lines.push(`  ${mermaidNode(id, node.name, node.kind ?? null)}`);
  }
  for (const edge of diagram.edges) {
    const source = idByName.get(edge.sourceName);
    const target = idByName.get(edge.targetName);
    if (!source || !target) continue;
    const label = mermaidLabel(edge.polarity);
    lines.push(
      edge.hasDelay
        ? `  ${source} -. ${label} .-> ${target}`
        : `  ${source} -- ${label} --> ${target}`,
    );
  }
  if (loops.length > 0) {
    lines.push("  %% ループ");
    for (const loop of loops) {
      const delay = loop.hasDelay ? "、遅れあり" : "";
      lines.push(
        `  %% ${loop.label}（${POLARITY_LABEL[loop.polarity]}${delay}）: ${loopPath(loop)}`,
      );
    }
  }
  return lines.join("\n");
}

/** markdown 表のセル。改行と縦棒を潰す */
function cell(text: string | null | undefined) {
  if (!text) return "";
  return text.replaceAll("|", "\\|").replaceAll(/\r?\n/g, " ");
}

/** kind ごとに意味を持つ数値・式を 1 セルにまとめる */
function nodeDetail(node: ExportDiagram["nodes"][number]) {
  if (node.kind === "stock" && node.initialValue != null)
    return `初期値: ${node.initialValue}`;
  if ((node.kind === "flow" || node.kind === "auxiliary") && node.expression)
    return `式: ${node.expression}`;
  if (node.kind === "constant" && node.value != null)
    return `値: ${node.value}`;
  return "";
}

export type ExportMarkdownInput = {
  title?: string | null;
  diagram: ExportDiagram;
  loops: readonly Loop[];
  /** ループ検出が上限で打ち切られたか */
  truncated?: boolean;
  matches?: readonly ArchetypeMatch[];
  notes?: ExportNotes | null;
};

/**
 * markdown。変数表 / リンク表（根拠付き）/ ループ / 原型 / ノート要約。
 * 空の節は「（まだありません）」と明示し、節自体は落とさない
 */
export function exportDiagramToMarkdown(input: ExportMarkdownInput): string {
  const { diagram, loops, matches = [], notes, truncated = false } = input;
  const lines: string[] = [];
  if (input.title) lines.push(`# ${input.title}`, "");

  lines.push("## 変数", "");
  if (diagram.nodes.length === 0) {
    lines.push("（まだ図はありません）");
  } else {
    lines.push(
      "| 変数 | 役割 | 単位 | メモ | 値・式 |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const node of diagram.nodes) {
      lines.push(
        `| ${cell(node.name)} | ${node.kind ? KIND_LABEL[node.kind] : ""} | ${cell(node.unit)} | ${cell(node.memo)} | ${cell(nodeDetail(node))} |`,
      );
    }
  }

  lines.push("", "## 因果リンク", "");
  if (diagram.edges.length === 0) {
    lines.push("（まだありません）");
  } else {
    lines.push(
      "| 原因 | 結果 | 極性 | 遅れ | 根拠 |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const edge of diagram.edges) {
      lines.push(
        `| ${cell(edge.sourceName)} | ${cell(edge.targetName)} | ${edge.polarity} | ${edge.hasDelay ? "あり" : ""} | ${cell(edge.rationale)} |`,
      );
    }
  }

  lines.push("", "## ループ", "");
  if (loops.length === 0) {
    lines.push("（まだ閉じたループはありません）");
  } else {
    for (const loop of loops) {
      const delay = loop.hasDelay ? "、遅れあり" : "";
      const confirmed = notes?.confirmedLoopIds.includes(loop.id)
        ? "、確認済み"
        : "";
      lines.push(
        `- ${loop.label}（${POLARITY_LABEL[loop.polarity]}${delay}${confirmed}）: ${loopPath(loop)}`,
      );
    }
    if (truncated) lines.push("- …ループが多いため一部を省略");
  }

  lines.push("", "## システム原型", "");
  if (matches.length === 0) {
    lines.push("（該当なし）");
  } else {
    const labelById = new Map(loops.map((l) => [l.id, l.label]));
    for (const match of matches) {
      const related = match.loopIds
        .map((id) => labelById.get(id) ?? id)
        .join(", ");
      lines.push(
        `- **${match.name}**（${related}）: ${match.description}`,
        `  - 確かめる問い: ${match.question}`,
        `  - 定石の介入: ${match.prescription}`,
        `  - よくある失敗: ${match.pitfalls}`,
      );
    }
  }

  lines.push("", "## 聞き取りノート", "");
  if (!notes) {
    lines.push("（まだありません）");
  } else {
    lines.push(`- テーマ: ${notes.theme ?? "（未記入）"}`);
    lines.push(
      `- 時間挙動: ${notes.behavior ? `${notes.behavior.pattern} — ${notes.behavior.description}` : "（未記入）"}`,
    );
    lines.push(`- 理想の推移: ${notes.idealBehavior ?? "（未記入）"}`);
    if (notes.stakeholders.length > 0) {
      lines.push("- 関係者:");
      for (const s of notes.stakeholders) {
        lines.push(`  - ${s.name}: ${s.concerns.join(" / ")}`);
      }
    }
    if (notes.variableCandidates.length > 0) {
      lines.push(
        `- 変数候補: ${notes.variableCandidates
          .map((v) => (v.source ? `${v.name}（${v.source}）` : v.name))
          .join(", ")}`,
      );
    }
  }

  return lines.join("\n");
}

export type ExportFormat = "mermaid" | "markdown";

/** DB の行をそのまま渡せる入力（ID 付き）。ループ・原型はここで導出する */
export type RenderExportInput = {
  title?: string | null;
  nodes: (ExportDiagram["nodes"][number] & { id: string })[];
  edges: {
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    polarity: "+" | "-";
    hasDelay: boolean;
    rationale: string;
  }[];
  notes?: ExportNotes | null;
};

/**
 * export_diagram / resources / Web の書き出しメニューが共有する入口。
 * ループ検出と原型マッチを済ませてからフォーマット別の描画に渡す
 */
export function renderDiagramExport(
  format: ExportFormat,
  input: RenderExportInput,
): string {
  const nameById = new Map(input.nodes.map((n) => [n.id, n.name]));
  const diagram: ExportDiagram = {
    nodes: input.nodes,
    edges: input.edges.map((e) => ({
      sourceName: nameById.get(e.sourceNodeId) ?? "",
      targetName: nameById.get(e.targetNodeId) ?? "",
      polarity: e.polarity,
      hasDelay: e.hasDelay,
      rationale: e.rationale,
    })),
  };
  // 式由来の情報リンクも含めた集合でループを見る（キャンバス / MCP と同じ入口）
  const loopEdges = buildLoopEdges(input);
  const loopResult = detectLoops(input.nodes, loopEdges);
  if (format === "mermaid") {
    return exportDiagramToMermaid(diagram, loopResult.loops);
  }
  return exportDiagramToMarkdown({
    title: input.title,
    diagram,
    loops: loopResult.loops,
    truncated: loopResult.truncated,
    matches: matchArchetypes(loopResult.loops, loopEdges),
    notes: input.notes,
  });
}
