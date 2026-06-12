import type { DiagramDiff } from "./diff-schema";

type CurrentNode = { id: string; name: string };
type CurrentEdge = { id: string; sourceNodeId: string; targetNodeId: string };

export type CurrentDiagram = {
  nodes: CurrentNode[];
  edges: CurrentEdge[];
};

/**
 * diff を DB 操作の計画に変換した結果。
 * createEdges のノード参照は名前のまま（新規ノードの ID が insert 時まで
 * 確定しないため）。適用側が createNodes の insert 後に名前 → ID を解決する。
 */
export type MutationPlan = {
  createNodes: { name: string; memo?: string; unit?: string }[];
  updateNodes: { id: string; memo?: string; unit?: string }[];
  deleteNodeIds: string[];
  createEdges: {
    sourceName: string;
    targetName: string;
    polarity: "+" | "-";
    hasDelay: boolean;
    rationale: string;
  }[];
  updateEdges: {
    id: string;
    polarity: "+" | "-";
    hasDelay: boolean;
    rationale: string;
  }[];
  deleteEdgeIds: string[];
  /** 不整合のため除外した操作の説明（AI へのフィードバックに使う） */
  warnings: string[];
};

export type PlanResult =
  | { ok: true; plan: MutationPlan }
  | { ok: false; reason: string };

/** 表記ゆれを吸収する名前の正規化（照合キー用。保存する名前は原文のまま） */
export function normalizeName(name: string) {
  return name.trim().normalize("NFKC").toLowerCase();
}

/**
 * AI の diff を検証し、DB 操作の計画へ決定的に変換する。
 * LLM の出力整合性に依存しない安全網:
 * - 参照先が存在しないエッジ操作は除外して warning にする
 * - 何も起きない diff・図の全消去になる diff は拒否する
 */
export function planDiagramMutation(
  current: CurrentDiagram,
  diff: DiagramDiff,
): PlanResult {
  const warnings: string[] = [];

  const nodesByKey = new Map(
    current.nodes.map((n) => [normalizeName(n.name), n]),
  );
  const nodeNameById = new Map(current.nodes.map((n) => [n.id, n.name]));

  // --- ノードの upsert / delete ---

  const createNodes: MutationPlan["createNodes"] = [];
  const updateNodes: MutationPlan["updateNodes"] = [];
  const seenUpsertKeys = new Set<string>();

  for (const node of diff.upsertNodes) {
    const key = normalizeName(node.name);
    if (seenUpsertKeys.has(key)) {
      warnings.push(`変数「${node.name}」が diff 内で重複しています（統合）`);
      continue;
    }
    seenUpsertKeys.add(key);

    const existing = nodesByKey.get(key);
    if (existing) {
      if (node.memo !== undefined || node.unit !== undefined) {
        updateNodes.push({ id: existing.id, memo: node.memo, unit: node.unit });
      }
    } else {
      createNodes.push(node);
    }
  }

  const deleteNodeIds: string[] = [];
  const deletedKeys = new Set<string>();
  for (const name of diff.deleteNodes) {
    const key = normalizeName(name);
    if (seenUpsertKeys.has(key)) {
      warnings.push(`変数「${name}」は追加と削除が同時指定のため削除を無視`);
      continue;
    }
    const existing = nodesByKey.get(key);
    if (!existing) {
      warnings.push(`削除対象の変数「${name}」は存在しません`);
      continue;
    }
    deleteNodeIds.push(existing.id);
    deletedKeys.add(key);
  }

  // 図の全消去は拒否（誤った全置換から図を守る）
  const remainingCount =
    current.nodes.length - deleteNodeIds.length + createNodes.length;
  if (current.nodes.length > 0 && remainingCount === 0) {
    return {
      ok: false,
      reason:
        "図のすべての変数を削除する操作は受け付けません。残す構造を明確にしてください",
    };
  }

  // --- エッジの upsert / delete ---

  // エッジ参照の解決先: 既存ノード（削除予定を除く）∪ 新規作成ノード
  const resolvableKeys = new Set<string>([
    ...current.nodes
      .filter((n) => !deletedKeys.has(normalizeName(n.name)))
      .map((n) => normalizeName(n.name)),
    ...createNodes.map((n) => normalizeName(n.name)),
  ]);

  const edgeByPairKey = new Map<string, CurrentEdge>(
    current.edges.map((e) => {
      const sourceName = nodeNameById.get(e.sourceNodeId) ?? "";
      const targetName = nodeNameById.get(e.targetNodeId) ?? "";
      return [
        `${normalizeName(sourceName)}→${normalizeName(targetName)}`,
        e,
      ] as const;
    }),
  );

  const createEdges: MutationPlan["createEdges"] = [];
  const updateEdges: MutationPlan["updateEdges"] = [];

  for (const edge of diff.upsertEdges) {
    const sourceKey = normalizeName(edge.source);
    const targetKey = normalizeName(edge.target);
    if (!resolvableKeys.has(sourceKey) || !resolvableKeys.has(targetKey)) {
      warnings.push(
        `リンク「${edge.source}→${edge.target}」は参照先の変数がないため除外`,
      );
      continue;
    }
    const existing = edgeByPairKey.get(`${sourceKey}→${targetKey}`);
    if (existing) {
      updateEdges.push({
        id: existing.id,
        polarity: edge.polarity,
        hasDelay: edge.hasDelay ?? false,
        rationale: edge.rationale,
      });
    } else {
      createEdges.push({
        sourceName: edge.source,
        targetName: edge.target,
        polarity: edge.polarity,
        hasDelay: edge.hasDelay ?? false,
        rationale: edge.rationale,
      });
    }
  }

  const deleteEdgeIds: string[] = [];
  for (const edge of diff.deleteEdges) {
    const pairKey = `${normalizeName(edge.source)}→${normalizeName(edge.target)}`;
    const existing = edgeByPairKey.get(pairKey);
    if (!existing) {
      warnings.push(
        `削除対象のリンク「${edge.source}→${edge.target}」は存在しません`,
      );
      continue;
    }
    deleteEdgeIds.push(existing.id);
  }

  // --- 空 diff の拒否 ---

  const operationCount =
    createNodes.length +
    updateNodes.length +
    deleteNodeIds.length +
    createEdges.length +
    updateEdges.length +
    deleteEdgeIds.length;
  if (operationCount === 0) {
    return {
      ok: false,
      reason:
        warnings.length > 0
          ? `有効な操作がありません: ${warnings.join(" / ")}`
          : "diff に操作が含まれていません",
    };
  }

  return {
    ok: true,
    plan: {
      createNodes,
      updateNodes,
      deleteNodeIds,
      createEdges,
      updateEdges,
      deleteEdgeIds,
      warnings,
    },
  };
}
