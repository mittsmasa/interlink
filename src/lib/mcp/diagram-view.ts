/**
 * get_diagram の応答をどこまで返すか決める純粋関数群。
 * 図が育つと全部返す応答は数千トークンになるため、セクション選択（include）・
 * 粒度（detail）・部分グラフ（focus）で絞る。各セクションの中身の形はここでは扱わない。
 */

/** include で選べる応答セクション。未指定なら全部 */
export const DIAGRAM_SECTIONS = [
  "nodes",
  "edges",
  "loops",
  "lint",
  "archetypes",
  "metrics",
  "sfd",
  "notes",
  "interview",
] as const;

export type DiagramSection = (typeof DIAGRAM_SECTIONS)[number];

/** focus の既定ホップ数 */
export const DEFAULT_FOCUS_DEPTH = 2;
/**
 * focus のホップ数上限。30〜40 ノード規模の図では 6 ホップも辿ればほぼ全体に届くため、
 * それ以上は「絞る」意味がなくなる（絞り込みを名乗る範囲の上限）
 */
export const MAX_FOCUS_DEPTH = 6;
/** detail: summary で返すループ件数の上限 */
export const SUMMARY_LOOP_LIMIT = 10;
/** detail: summary で返す lint 指摘の上限 */
export const SUMMARY_LINT_LIMIT = 10;
/** detail: summary で残す rationale の文字数 */
export const SUMMARY_RATIONALE_LENGTH = 40;

/**
 * 返すセクションを決める。未指定・空配列は全セクション（従来の応答と同じ）。
 * 未知の名前は呼び出し側の zod スキーマで弾く前提
 */
export function selectSections(
  include?: readonly DiagramSection[],
): Set<DiagramSection> {
  if (!include || include.length === 0) return new Set(DIAGRAM_SECTIONS);
  return new Set(include);
}

/** 上限で切ったことを読み手に伝えるメタ情報。limit: null は上限なし */
export type LimitInfo = {
  truncated: boolean;
  shown: number;
  limit: number | null;
};

/**
 * 配列を上限で切り、切ったかどうかを添える。
 * alreadyTruncated は上流（detectLoops の MAX_LOOPS 打ち切りなど）で既に落ちている場合に渡す。
 * ここで OR しないと「50 件で切られた事実」が要約の上限に塗り潰される
 */
export function applyLimit<T>(
  items: readonly T[],
  limit: number | null,
  alreadyTruncated = false,
): { items: T[]; info: LimitInfo } {
  const shown = limit === null ? [...items] : items.slice(0, limit);
  return {
    items: shown,
    info: {
      truncated: alreadyTruncated || shown.length < items.length,
      shown: shown.length,
      limit,
    },
  };
}

/** rationale を要約する（超過分は末尾を省略記号に）。コードポイント単位で数える */
export function summarizeRationale(
  rationale: string | null,
  maxLength: number = SUMMARY_RATIONALE_LENGTH,
): string | null {
  if (rationale === null) return null;
  const chars = Array.from(rationale);
  if (chars.length <= maxLength) return rationale;
  return `${chars.slice(0, maxLength).join("")}…`;
}

/** 部分グラフを辿るためのリンク（因果エッジと式由来リンクを同じ形に均す） */
export type GraphLink = { from: string; to: string };

/**
 * startNodeId から depth ホップ以内に届くノード ID を集める。
 * 向きは問わない（上流も下流も「その変数の周り」なので無向で辿る）。
 * depth 0 なら自分だけ。図に無い ID を渡しても自分だけが返る
 */
export function collectNeighborhood(
  links: readonly GraphLink[],
  startNodeId: string,
  depth: number,
): Set<string> {
  const visited = new Set([startNodeId]);
  if (depth <= 0) return visited;

  const adjacency = new Map<string, string[]>();
  const connect = (from: string, to: string) => {
    const neighbors = adjacency.get(from);
    if (neighbors) neighbors.push(to);
    else adjacency.set(from, [to]);
  };
  for (const link of links) {
    connect(link.from, link.to);
    connect(link.to, link.from);
  }

  let frontier = [startNodeId];
  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const neighbor of adjacency.get(nodeId) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return visited;
}
