import type { EdgeStatus, NodeKind } from "@/db/schema";
import type { Loop } from "@/lib/diagram/loops";
import {
  computeDiagramMetrics,
  describeCandidate,
} from "@/lib/diagram/metrics";
import type { SimConfigRecord } from "@/lib/diagram/sim-config";
import { describeSuggestion, suggestKinds } from "@/lib/diagram/suggest-kinds";
import { checkBehaviorConsistency, describeInconsistency } from "./consistency";
import { HYPOTHESIS_STATUS_LABELS, type InterviewNotes } from "./notes";
import type { InterviewPhase } from "./phase";

/** プロンプトに注入するアジェンダ件数の上限（トークン抑制。一括質問のため少し緩める） */
export const MAX_AGENDA_ITEMS = 4;
/** 端点ノード（原因・影響が未接続）の指摘件数上限 */
const MAX_ENDPOINT_ITEMS = 3;
/** insight で一度に提示する介入候補の上限（多いと問いが散る） */
const MAX_CANDIDATE_ITEMS = 2;
/** quantify で一度に提示する昇格候補の上限（多いと確定の対話が散る） */
const MAX_KIND_ITEMS = 2;
/** 名前を列挙する件数の上限（「ほか」で丸める） */
const MAX_NAMED_ITEMS = 2;

type AgendaInput = {
  nodes: {
    id: string;
    name: string;
    /** 以下は quantify の項目に使う。省略した呼び出し（旧 fixture）ではその項目が出ないだけ */
    unit?: string | null;
    kind?: NodeKind | null;
    expression?: string | null;
    initialValue?: number | null;
  }[];
  edges: {
    /** 最弱リンクの特定に使う。省略した呼び出し（旧 fixture）ではその項目が出ないだけ */
    id?: string;
    sourceNodeId: string;
    targetNodeId: string;
    status?: EdgeStatus;
  }[];
  loops: readonly Loop[];
  /** 保存済みのシミュレーション設定。未指定なら時間軸の項目を出さない */
  simConfig?: SimConfigRecord | null;
};

/** 最弱リンクの優先順（先ほど弱い） */
const WEAKNESS_ORDER: EdgeStatus[] = ["disputed", "inferred", "confirmed"];

/**
 * 確認済みループの中でまだ確かでないリンクを拾う。「ループに納得した」は輪全体の印象で、
 * 個々のリンクは推測のままのことがあるため、ループごとの最弱リンク（disputed > inferred）を
 * 具体的に問う項目にする。確認済みループ 1 つにつき 1 件
 */
function buildWeakLinkItems(
  nodes: AgendaInput["nodes"],
  edges: AgendaInput["edges"],
  loops: readonly Loop[],
  confirmedLoopIds: readonly string[],
): string[] {
  const confirmed = new Set(confirmedLoopIds);
  const edgeById = new Map(
    edges.flatMap((e) => (e.id ? [[e.id, e] as const] : [])),
  );
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const items: string[] = [];
  for (const loop of loops) {
    if (!confirmed.has(loop.id)) continue;
    const members = loop.edgeIds.flatMap((id) => {
      const edge = edgeById.get(id);
      return edge?.status ? [edge] : [];
    });
    const inferredCount = members.filter((e) => e.status === "inferred").length;
    const weakest = members
      .filter((e) => e.status !== "confirmed")
      .sort(
        (a, b) =>
          WEAKNESS_ORDER.indexOf(a.status as EdgeStatus) -
          WEAKNESS_ORDER.indexOf(b.status as EdgeStatus),
      )[0];
    if (!weakest) continue;
    const link = `${nameById.get(weakest.sourceNodeId) ?? ""}→${nameById.get(weakest.targetNodeId) ?? ""}`;
    const weakestLabel =
      weakest.status === "disputed" ? "ユーザーが疑問視した" : "推測のままの";
    const countText =
      inferredCount > 0 ? `推測のままのリンクが ${inferredCount} 本ある。` : "";
    items.push(
      `確認済みのループ ${loop.label} の中に${countText}最も弱いのは${weakestLabel}「${link}」。「他の条件が同じなら、${nameById.get(weakest.sourceNodeId) ?? ""}が増えると${nameById.get(weakest.targetNodeId) ?? ""}はどうなりますか?」と確かめ、実感と合えば status を confirmed に、違えば disputed にして張り直す`,
    );
  }
  return items;
}

/** 原因 or 影響が未接続の端点ノードを「次に埋める所」として並べる */
function buildEndpointItems(
  nodes: AgendaInput["nodes"],
  edges: AgendaInput["edges"],
): string[] {
  if (edges.length === 0) return [];
  const hasIncoming = new Set<string>();
  const hasOutgoing = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceNodeId === edge.targetNodeId) continue; // 自己ループは両向き扱いしない
    hasOutgoing.add(edge.sourceNodeId);
    hasIncoming.add(edge.targetNodeId);
  }
  const items: string[] = [];
  for (const node of nodes) {
    if (!hasIncoming.has(node.id)) {
      items.push(
        `変数「${node.name}」を動かしている原因がまだ図にない。推論で補えそうなら描き、怪しければ「何がこれを増やしたり減らしたりしていますか?」と確かめる`,
      );
    } else if (!hasOutgoing.has(node.id)) {
      items.push(
        `変数「${node.name}」がどこへ影響するかがまだ図にない。推論で補えそうなら描き、怪しければ「これが増えると、何が変わりますか?」と確かめる`,
      );
    }
  }
  return items.slice(0, MAX_ENDPOINT_ITEMS);
}

/** テーマ全体・変数ごとの挙動と構造の不整合を指示文にする */
function buildInconsistencyItems(
  notes: InterviewNotes,
  loops: readonly Loop[],
): string[] {
  return checkBehaviorConsistency(notes, loops)
    .filter((c) => !c.consistent)
    .map(describeInconsistency);
}

/**
 * インサイト: 確かめた構造のどこに手を入れるかを、構造指標から候補を出して問う。
 * 候補 → 不整合 → 未検証の仮説 → 未確認ループの残件、の順
 */
function buildInsightItems(
  notes: InterviewNotes,
  { nodes, edges, loops }: AgendaInput,
): string[] {
  const items: string[] = [];

  const { interventionCandidates } = computeDiagramMetrics(nodes, edges, loops);
  const shown = interventionCandidates.slice(0, MAX_CANDIDATE_ITEMS);
  if (shown.length > 0) {
    const list = shown
      .map((c) => `「${c.name}」（${describeCandidate(c)}）`)
      .join("、");
    items.push(
      `介入候補: ${list}。複数のループが交わる変数は、小さな変化が全体に波及しやすい。「ここに手を入れたら、何が起きそうですか?」と問い、介入の効果はシミュレーションの overrides（run_simulation）でその変数を動かして確かめる。立てた仮説は updateNotes の hypotheses に leveragePoint / expectedEffect / 関係する loopIds で記録する`,
    );
  } else {
    items.push(
      "ループの交点になる変数がまだ無い。確認済みのループのどこに手を入れると流れが変わりそうかをユーザーと考え、仮説を updateNotes の hypotheses に記録する",
    );
  }

  items.push(...buildInconsistencyItems(notes, loops));

  const proposed = notes.hypotheses.filter((h) => h.status === "proposed");
  if (proposed.length > 0) {
    const list = proposed
      .map((h) => `「${h.leveragePoint} → ${h.expectedEffect}」`)
      .join("、");
    items.push(
      `まだ試していない${HYPOTHESIS_STATUS_LABELS.proposed}: ${list}。シミュレーションの overrides でその変数を動かし、期待した効果が出るかを見比べる。結果に応じて hypotheses の status を tested / rejected に更新する`,
    );
  }

  const confirmed = new Set(notes.confirmedLoopIds);
  const unconfirmed = loops.filter((l) => !confirmed.has(l.id));
  if (unconfirmed.length > 0) {
    items.push(
      `未確認のループが ${unconfirmed.length} 件残っている（${unconfirmed
        .slice(0, 3)
        .map((l) => l.label)
        .join(
          ", ",
        )}${unconfirmed.length > 3 ? " ほか" : ""}）。介入の議論に関わるものから、実感と合うかを確かめる`,
    );
  }

  return items;
}

/** 名前を最大 2 件並べ、残りは「ほか」で丸める */
function listNames(names: string[]): string {
  const shown = names.slice(0, MAX_NAMED_ITEMS).map((n) => `「${n}」`);
  return `${shown.join("、")}${names.length > MAX_NAMED_ITEMS ? " ほか" : ""}`;
}

/**
 * 定量化: 図に数値的な意味を入れ、仮説を数値で試せる形にする。
 * 昇格候補 → 時間軸 → 初期値 → 式、の順（前ほど後段の前提になる）。
 * 昇格の提案は決定的なヒューリスティックで、確定するのはユーザー（doc 3 章）
 */
function buildQuantifyItems(
  notes: InterviewNotes,
  { nodes, edges, loops, simConfig }: AgendaInput,
): string[] {
  const items: string[] = [];

  const suggestions = suggestKinds(
    nodes.map((n) => ({
      id: n.id,
      name: n.name,
      unit: n.unit ?? null,
      kind: n.kind ?? null,
    })),
    edges,
    loops,
  ).slice(0, MAX_KIND_ITEMS);
  if (suggestions.length > 0) {
    const list = suggestions
      .map(
        (s) =>
          `「${s.name}」は${describeSuggestion(s)}。根拠: ${s.reasons.join(" / ")}`,
      )
      .join("　")
      .trim();
    items.push(
      `まだ役割の決まっていない変数がある。昇格候補: ${list}。昇格は提案 → ユーザー確定の順で進める。「時間を止めても残る量ですか、それとも『〜あたり』の速さですか」と一時停止テストで確かめてから、updateDiagram で kind を書く`,
    );
  }

  if (simConfig && simConfig.timeUnit === null) {
    const hint = notes.timeHorizon
      ? `聞き取りでは「${notes.timeHorizon.unit}」の粒度で語られているので、それを叩き台にする。`
      : "";
    items.push(
      `シミュレーションの時間軸がまだ決まっていない。${hint}「1 ステップを何と見ますか（週 / 月 / 四半期）」「どのくらい先まで見たいですか」をまとめて聞き、dt / steps / 時間単位として保存する`,
    );
  }

  const missingInitial = nodes.filter(
    (n) => n.kind === "stock" && n.initialValue == null,
  );
  if (missingInitial.length > 0) {
    items.push(
      `初期値の無いストックが ${missingInitial.length} 件ある（${listNames(missingInitial.map((n) => n.name))}）。「いまの水準は、0〜100 で言うとどのくらいですか」と粗い見立てで構わないので聞き、updateDiagram の initialValue に入れる`,
    );
  }

  const missingExpression = nodes.filter(
    (n) =>
      (n.kind === "flow" || n.kind === "auxiliary") && !n.expression?.trim(),
  );
  if (missingExpression.length > 0) {
    items.push(
      `式の無いフロー / 補助変数が ${missingExpression.length} 件ある（${listNames(missingExpression.map((n) => n.name))}）。何がその速さ・値を決めているかを聞き、updateDiagram の expression に書く（四則演算・べき乗と min/max/clamp/pow/smooth/delay、変数名は図にあるものだけ）`,
    );
  }

  return items;
}

/**
 * 「次にすること」を優先順で導出する。ドラフト先行なので、AI が叩き台を
 * 描く指示と、その叩き台の「違和感ポイント（=ユーザーに一括で問う所）」を
 * フェーズに応じて並べる。detectLoops の結果と degree 計算だけで成立し、
 * グラフ探索は持たない。返り値はプロンプトへそのまま並べる指示文。
 */
export function buildInterviewAgenda(
  notes: InterviewNotes,
  { nodes, edges, loops, simConfig }: AgendaInput,
  phase: InterviewPhase,
): string[] {
  // 焦点: まずテーマと時間挙動を一括で掴む。掴めたら次ターンで描く
  if (phase === "focus") {
    return [
      "まずテーマ（何に困っているか）と、その時間挙動（いつ頃から・増え続け / 減り続け / 振動 / 頭打ち など）、理想の推移を、ひとつのメッセージでまとめて聞く。掴めたら updateNotes に記録し、次のターンでドラフト図を描く",
    ];
  }

  // ドラフト: AI が叩き台を描く番。図の状態で指示を変える
  if (phase === "draft") {
    const items: string[] = [];
    if (nodes.length === 0) {
      items.push(
        "焦点は掴めている。待たずに、自分の推論で変数 5〜8 個と因果リンクを一枚描き、少なくとも 1 つループを閉じにいく（updateDiagram）。推測で張ったリンクは rationale に「推測」と明記する",
      );
    } else {
      items.push(
        "まだループが閉じていない。円環を閉じるために足りない変数とリンクを推論で補い、updateDiagram でドラフトを進める",
      );
      items.push(...buildEndpointItems(nodes, edges));
    }
    items.push(
      "描いたドラフトを見せ、「特にこの辺りは推測なので、違和感があれば教えてください」と、怪しいリンクや抜けていそうな変数を箇条書きでまとめて問う（一問一答にしない）",
    );
    return items.slice(0, MAX_AGENDA_ITEMS);
  }

  // インサイト: どこに手を入れるかを構造指標から問う
  if (phase === "insight") {
    return buildInsightItems(notes, { nodes, edges, loops }).slice(
      0,
      MAX_AGENDA_ITEMS,
    );
  }

  // 定量化: 役割・時間軸・初期値・式を入れ、仮説を数値で試せる形にする
  if (phase === "quantify") {
    return buildQuantifyItems(notes, {
      nodes,
      edges,
      loops,
      simConfig,
    }).slice(0, MAX_AGENDA_ITEMS);
  }

  // すり合わせ: ドラフトを実感と突き合わせ、違和感を直す
  const items: string[] = [];

  // 1. 未確認ループ: ユーザーの実感でまだ確かめていないループを読み上げる
  const confirmed = new Set(notes.confirmedLoopIds);
  const unconfirmed = loops.find((loop) => !confirmed.has(loop.id));
  if (unconfirmed) {
    const path = `${unconfirmed.nodeNames.join(" → ")} → ${unconfirmed.nodeNames[0]}`;
    items.push(
      `ループ ${unconfirmed.label}（${path}）はまだユーザーの実感で確かめていない。この輪を日常の言葉の物語として読み上げ、「この循環、実感と合いますか?」と確認する。納得が得られたら updateNotes で confirmedLoopIds に "${unconfirmed.id}" を追加する`,
    );
  }

  // 2. 確認済みループの最弱リンク: 輪として納得していても個々のリンクが推測のままなら確かめる
  items.push(
    ...buildWeakLinkItems(nodes, edges, loops, notes.confirmedLoopIds),
  );

  // 3. 挙動と構造の不整合: 構造から予想される挙動（R=増殖 / B+遅れ=振動）と実挙動を突き合わせる
  items.push(...buildInconsistencyItems(notes, loops));

  // 4. 端点ノード: 原因や影響が未接続の変数を埋める
  items.push(...buildEndpointItems(nodes, edges));

  return items.slice(0, MAX_AGENDA_ITEMS);
}
