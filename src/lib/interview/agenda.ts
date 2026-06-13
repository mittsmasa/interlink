import type { Loop } from "@/lib/diagram/loops";
import { BEHAVIOR_PATTERN_LABELS, type InterviewNotes } from "./notes";
import type { InterviewPhase } from "./phase";

/** プロンプトに注入するアジェンダ件数の上限（トークン抑制） */
export const MAX_AGENDA_ITEMS = 3;
/** 端点ノード（原因・影響が未接続）の指摘件数上限 */
const MAX_ENDPOINT_ITEMS = 2;

type AgendaInput = {
  nodes: { id: string; name: string }[];
  edges: { sourceNodeId: string; targetNodeId: string }[];
  loops: readonly Loop[];
};

/**
 * 「次に聞くこと」を優先順で導出する。detectLoops の結果と degree 計算
 * だけで成立し、グラフ探索は持たない。返り値はプロンプトへそのまま
 * 並べる指示文（最大 MAX_AGENDA_ITEMS 件）。
 *
 * 優先順:
 * 1. 未確認ループ — 物語として読み上げ、実感を確かめる（納得感の核）
 * 2. 挙動と構造の不整合 — BOT で聞いた実挙動と図の構造の答え合わせ
 * 3. 端点ノード — 原因・影響が未接続の変数の深掘り
 * 4. ノートの空欄・未変数化の関係者 — 発散の穴埋め
 */
export function buildInterviewAgenda(
  notes: InterviewNotes,
  { nodes, edges, loops }: AgendaInput,
  phase: InterviewPhase,
): string[] {
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

  // 2. 挙動と構造の不整合（仮説検証フェーズのみ）:
  //    構造から予想される挙動（R=増殖 / B+遅れ=振動）と実挙動を突き合わせる
  if (phase === "hypothesis" && notes.behavior) {
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

  // 3. 端点ノード: 原因や影響が未接続の変数（エッジが 1 本もない図では全ノードが
  //    端点になりノイズなので、エッジが張られ始めてから効かせる）
  if (edges.length > 0) {
    const hasIncoming = new Set<string>();
    const hasOutgoing = new Set<string>();
    for (const edge of edges) {
      if (edge.sourceNodeId === edge.targetNodeId) continue; // 自己ループは両向き扱いしない
      hasOutgoing.add(edge.sourceNodeId);
      hasIncoming.add(edge.targetNodeId);
    }
    const endpointItems: string[] = [];
    for (const node of nodes) {
      if (!hasIncoming.has(node.id)) {
        endpointItems.push(
          `変数「${node.name}」を動かしている原因がまだ図にない。「何がこれを増やしたり減らしたりしていますか?」と尋ねる`,
        );
      } else if (!hasOutgoing.has(node.id)) {
        endpointItems.push(
          `変数「${node.name}」がどこへ影響するかがまだ図にない。「これが増えると、何が変わりますか?」と尋ねる`,
        );
      }
    }
    items.push(...endpointItems.slice(0, MAX_ENDPOINT_ITEMS));
  }

  // 4. ノートの空欄・未変数化の関係者（発散の穴埋め）
  if (notes.theme === null || notes.behavior === null) {
    items.push(
      `テーマと時間挙動（いつから・どんな形で変化してきたか）がまだノートにない。聞き取って updateNotes に記録する`,
    );
  } else {
    const candidateSources = new Set(
      notes.variableCandidates.map((c) => c.source),
    );
    const unvaried = notes.stakeholders.find(
      (s) => !candidateSources.has(s.name),
    );
    if (unvaried) {
      const concerns =
        unvaried.concerns.length > 0
          ? `（関心事: ${unvaried.concerns.join(" / ")}）`
          : "";
      items.push(
        `関係者「${unvaried.name}」${concerns}の関心事がまだ変数になっていない。「それは何が増えたり減ったりする話ですか?」と変数化し、updateNotes の variableCandidates に記録する`,
      );
    }
  }

  return items.slice(0, MAX_AGENDA_ITEMS);
}
