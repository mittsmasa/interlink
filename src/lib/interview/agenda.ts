import type { Loop } from "@/lib/diagram/loops";
import { BEHAVIOR_PATTERN_LABELS, type InterviewNotes } from "./notes";
import type { InterviewPhase } from "./phase";

/** プロンプトに注入するアジェンダ件数の上限（トークン抑制。一括質問のため少し緩める） */
export const MAX_AGENDA_ITEMS = 4;
/** 端点ノード（原因・影響が未接続）の指摘件数上限 */
const MAX_ENDPOINT_ITEMS = 3;

type AgendaInput = {
  nodes: { id: string; name: string }[];
  edges: { sourceNodeId: string; targetNodeId: string }[];
  loops: readonly Loop[];
};

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

/**
 * 「次にすること」を優先順で導出する。ドラフト先行なので、AI が叩き台を
 * 描く指示と、その叩き台の「違和感ポイント（=ユーザーに一括で問う所）」を
 * フェーズに応じて並べる。detectLoops の結果と degree 計算だけで成立し、
 * グラフ探索は持たない。返り値はプロンプトへそのまま並べる指示文。
 */
export function buildInterviewAgenda(
  notes: InterviewNotes,
  { nodes, edges, loops }: AgendaInput,
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

  // 2. 挙動と構造の不整合: 構造から予想される挙動（R=増殖 / B+遅れ=振動）と実挙動を突き合わせる
  if (notes.behavior) {
    const pattern = notes.behavior.pattern;
    const hasReinforcing = loops.some((l) => l.polarity === "R");
    const hasDelayedBalancing = loops.some(
      (l) => l.polarity === "B" && l.hasDelay,
    );
    if (
      (pattern === "increasing" || pattern === "decreasing") &&
      !hasReinforcing
    ) {
      items.push(
        `実際の挙動は「${BEHAVIOR_PATTERN_LABELS[pattern]}」なのに、図には自己強化（R）ループがない。変化を駆動し続けている強化構造がまだ描けていない可能性が高い。「何がこの変化をさらに加速させていますか?」と探る`,
      );
    }
    if (pattern === "oscillating" && !hasDelayedBalancing) {
      items.push(
        `実際の挙動は「振動している」のに、振動を生む遅れ付きのバランス（B）ループが図にない。対処や調整の効果が現れるまでに時間差がないかを探る`,
      );
    }
  }

  // 3. 端点ノード: 原因や影響が未接続の変数を埋める
  items.push(...buildEndpointItems(nodes, edges));

  return items.slice(0, MAX_AGENDA_ITEMS);
}
