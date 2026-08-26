import type { EdgeStatus, NodeKind } from "@/db/schema";
import type { DiagramDiff } from "./diff-schema";
import { validateExpressionStructure } from "./simulate";

type CurrentNode = { id: string; name: string };
type CurrentEdge = { id: string; sourceNodeId: string; targetNodeId: string };

export type CurrentDiagram = {
  nodes: CurrentNode[];
  edges: CurrentEdge[];
};

/** kind 別に正規化済みの SFD 列。kind 指定があったノードにのみ付く */
type SfdColumns = {
  kind: NodeKind | null;
  expression: string | null;
  initialValue: number | null;
  value: number | null;
};

type NodeFields = {
  memo?: string;
  unit?: string;
} & Partial<SfdColumns>;

/**
 * diff を DB 操作の計画に変換した結果。
 * createEdges のノード参照は名前のまま（新規ノードの ID が insert 時まで
 * 確定しないため）。適用側が createNodes の insert 後に名前 → ID を解決する。
 */
export type MutationPlan = {
  createNodes: ({ name: string } & NodeFields)[];
  updateNodes: ({ id: string } & NodeFields)[];
  deleteNodeIds: string[];
  createEdges: {
    sourceName: string;
    targetName: string;
    polarity: "+" | "-";
    hasDelay: boolean;
    rationale: string;
    status: EdgeStatus;
  }[];
  updateEdges: {
    id: string;
    polarity: "+" | "-";
    hasDelay: boolean;
    rationale: string;
    /** 省略時は現状維持（適用側で列を触らない） */
    status?: EdgeStatus;
  }[];
  deleteEdgeIds: string[];
  /** 不整合のため除外・縮退した操作（AI へのフィードバックに使う） */
  warnings: MutationWarning[];
};

export type MutationWarningCode =
  /** 参照先の変数がないリンク（除外） */
  | "unresolved-edge"
  /** flow / auxiliary の式が無効（式だけ null で保存） */
  | "invalid-expression"
  /** kind 指定なしで式/初期値/定数値が来た（SFD 列を無視） */
  | "kind-missing"
  /** diff 内で同名の upsertNodes が重複（2 つ目以降を無視） */
  | "duplicate-node"
  /** diff 内で同じペアの upsertEdges が重複（後の指定で上書き） */
  | "duplicate-edge"
  /** 同じ変数が upsertNodes と deleteNodes の両方にある（削除を無視） */
  | "delete-conflict"
  /** 削除対象の変数が存在しない */
  | "missing-node"
  /** 削除対象のリンクが存在しない */
  | "missing-edge";

/**
 * 構造化した warning。message は人間/AI 向けの日本語文で、
 * code / target は機械的な分岐と再送に使う。
 * suggestion は修正候補（unresolved-edge なら近い既存変数名）
 */
export type MutationWarning = {
  code: MutationWarningCode;
  /** 対象の変数名、またはリンクなら "source→target" */
  target: string;
  message: string;
  suggestion?: string[];
};

export type PlanResult =
  | { ok: true; plan: MutationPlan }
  | { ok: false; reason: string; warnings: MutationWarning[] };

/** 表記ゆれを吸収する名前の正規化（照合キー用。保存する名前は原文のまま） */
export function normalizeName(name: string) {
  return name.trim().normalize("NFKC").toLowerCase();
}

/** 修正候補として返す近傍名の最大数 */
const MAX_SUGGESTIONS = 3;

/** 2 文字列のレーベンシュタイン距離（短い変数名向けの素朴な実装） */
function editDistance(a: string, b: string) {
  const ac = Array.from(a);
  const bc = Array.from(b);
  let prev = Array.from({ length: bc.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ac.length; i++) {
    const cur = [i];
    for (let j = 1; j <= bc.length; j++) {
      const cost = ac[i - 1] === bc[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[bc.length];
}

/**
 * 未解決の変数名に近い既存名を返す（正規化後に部分一致、または編集距離が
 * 名前長の 1/2 以下）。近い順に最大 MAX_SUGGESTIONS 件
 */
export function suggestNodeNames(name: string, candidates: string[]) {
  const key = normalizeName(name);
  if (!key) return [];
  const scored: { name: string; score: number }[] = [];
  for (const candidate of candidates) {
    const ck = normalizeName(candidate);
    if (ck === key) continue;
    if (ck.includes(key) || key.includes(ck)) {
      scored.push({ name: candidate, score: 0 });
      continue;
    }
    const distance = editDistance(key, ck);
    const limit = Math.floor(Math.max(key.length, ck.length) / 2);
    if (distance <= limit) scored.push({ name: candidate, score: distance });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_SUGGESTIONS)
    .map((s) => s.name);
}

/**
 * diff のノードから永続化する SFD 列を kind 別に正規化する。
 * `updateNode`（_actions）と同じ規律: kind に応じて関連列のみ残し、無関係列は null 化。
 * - kind 未指定（undefined）: SFD 変更なし（columns は null）。式/初期値だけ来ても無視し warning
 * - kind=null: 未分類へ戻す（3 列とも null）
 * - stock: initialValue のみ / constant: value のみ
 * - flow / auxiliary: expression のみ（validateExpressionStructure で検証。不正なら式 null + warning）
 */
function normalizeSfdFields(node: DiagramDiff["upsertNodes"][number]): {
  columns: SfdColumns | null;
  warnings: MutationWarning[];
} {
  const warnings: MutationWarning[] = [];

  if (node.kind === undefined) {
    if (
      node.expression !== undefined ||
      node.initialValue !== undefined ||
      node.value !== undefined
    ) {
      warnings.push({
        code: "kind-missing",
        target: node.name,
        message: `変数「${node.name}」に役割（kind）の指定がないため、式/初期値/定数値は無視しました`,
        suggestion: ["kind に stock / flow / auxiliary / constant を指定する"],
      });
    }
    return { columns: null, warnings };
  }

  const kind = node.kind;
  if (kind === null) {
    return {
      columns: {
        kind: null,
        expression: null,
        initialValue: null,
        value: null,
      },
      warnings,
    };
  }
  if (kind === "stock") {
    return {
      columns: {
        kind,
        expression: null,
        initialValue: node.initialValue ?? null,
        value: null,
      },
      warnings,
    };
  }
  if (kind === "constant") {
    return {
      columns: {
        kind,
        expression: null,
        initialValue: null,
        value: node.value ?? null,
      },
      warnings,
    };
  }

  // flow / auxiliary
  let expression = node.expression?.trim() ? node.expression.trim() : null;
  if (expression) {
    const err = validateExpressionStructure(expression);
    if (err) {
      warnings.push({
        code: "invalid-expression",
        target: node.name,
        message: `「${node.name}」の式が無効なため保存しませんでした: ${err.message}`,
        suggestion: ["式は四則演算と既存の変数名のみで書き直す"],
      });
      expression = null;
    }
  }
  return {
    columns: { kind, expression, initialValue: null, value: null },
    warnings,
  };
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
  const warnings: MutationWarning[] = [];

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
      warnings.push({
        code: "duplicate-node",
        target: node.name,
        message: `変数「${node.name}」が diff 内で重複しています（統合）`,
      });
      continue;
    }
    seenUpsertKeys.add(key);

    const { columns: sfd, warnings: sfdWarnings } = normalizeSfdFields(node);
    warnings.push(...sfdWarnings);

    const existing = nodesByKey.get(key);
    if (existing) {
      const hasMeta = node.memo !== undefined || node.unit !== undefined;
      if (hasMeta || sfd) {
        updateNodes.push({
          id: existing.id,
          memo: node.memo,
          unit: node.unit,
          ...(sfd ?? {}),
        });
      }
    } else {
      createNodes.push({
        name: node.name,
        memo: node.memo,
        unit: node.unit,
        ...(sfd ?? {}),
      });
    }
  }

  const deleteNodeIds: string[] = [];
  const deletedKeys = new Set<string>();
  for (const name of diff.deleteNodes) {
    const key = normalizeName(name);
    if (seenUpsertKeys.has(key)) {
      warnings.push({
        code: "delete-conflict",
        target: name,
        message: `変数「${name}」は追加と削除が同時指定のため削除を無視`,
      });
      continue;
    }
    const existing = nodesByKey.get(key);
    if (!existing) {
      const suggestion = suggestNodeNames(
        name,
        current.nodes.map((n) => n.name),
      );
      warnings.push({
        code: "missing-node",
        target: name,
        message: `削除対象の変数「${name}」は存在しません`,
        ...(suggestion.length > 0 ? { suggestion } : {}),
      });
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
      warnings,
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

  const resolvableNames = [
    ...current.nodes
      .filter((n) => !deletedKeys.has(normalizeName(n.name)))
      .map((n) => n.name),
    ...createNodes.map((n) => n.name),
  ];

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

  // 同じペアを 1 diff 内で 2 回 upsert された場合の行き先。ペアあたり 1 行に畳み、
  // 後の指定で上書きする（DB のペア一意制約と揃える。2 本目を別行として作らない）
  const plannedEdgeByPairKey = new Map<
    string,
    { list: "create" | "update"; index: number }
  >();

  for (const edge of diff.upsertEdges) {
    const sourceKey = normalizeName(edge.source);
    const targetKey = normalizeName(edge.target);
    if (!resolvableKeys.has(sourceKey) || !resolvableKeys.has(targetKey)) {
      const unresolved = [edge.source, edge.target].filter(
        (name) => !resolvableKeys.has(normalizeName(name)),
      );
      const suggestion = unresolved.flatMap((name) =>
        suggestNodeNames(name, resolvableNames),
      );
      warnings.push({
        code: "unresolved-edge",
        target: `${edge.source}→${edge.target}`,
        message: `リンク「${edge.source}→${edge.target}」は参照先の変数「${unresolved.join("」「")}」がないため除外`,
        ...(suggestion.length > 0
          ? { suggestion: [...new Set(suggestion)] }
          : {}),
      });
      continue;
    }
    const pairKey = `${sourceKey}→${targetKey}`;
    const planned = plannedEdgeByPairKey.get(pairKey);
    const existing = edgeByPairKey.get(pairKey);

    if (planned) {
      // 後勝ちで丸ごと差し替える（「最後の 1 件だけが送られた」のと同じ結果にする）
      warnings.push({
        code: "duplicate-edge",
        target: `${edge.source}→${edge.target}`,
        message: `リンク「${edge.source}→${edge.target}」が diff 内で重複しています（後の指定で上書き）`,
      });
      if (planned.list === "update") {
        updateEdges[planned.index] = {
          id: updateEdges[planned.index].id,
          polarity: edge.polarity,
          hasDelay: edge.hasDelay ?? false,
          rationale: edge.rationale,
          ...(edge.status !== undefined ? { status: edge.status } : {}),
        };
      } else {
        createEdges[planned.index] = {
          sourceName: edge.source,
          targetName: edge.target,
          polarity: edge.polarity,
          hasDelay: edge.hasDelay ?? false,
          rationale: edge.rationale,
          status: edge.status ?? "inferred",
        };
      }
      continue;
    }

    if (existing) {
      plannedEdgeByPairKey.set(pairKey, {
        list: "update",
        index: updateEdges.length,
      });
      updateEdges.push({
        id: existing.id,
        polarity: edge.polarity,
        hasDelay: edge.hasDelay ?? false,
        rationale: edge.rationale,
        ...(edge.status !== undefined ? { status: edge.status } : {}),
      });
    } else {
      plannedEdgeByPairKey.set(pairKey, {
        list: "create",
        index: createEdges.length,
      });
      createEdges.push({
        sourceName: edge.source,
        targetName: edge.target,
        polarity: edge.polarity,
        hasDelay: edge.hasDelay ?? false,
        rationale: edge.rationale,
        status: edge.status ?? "inferred",
      });
    }
  }

  const deleteEdgeIds: string[] = [];
  for (const edge of diff.deleteEdges) {
    const pairKey = `${normalizeName(edge.source)}→${normalizeName(edge.target)}`;
    const existing = edgeByPairKey.get(pairKey);
    if (!existing) {
      warnings.push({
        code: "missing-edge",
        target: `${edge.source}→${edge.target}`,
        message: `削除対象のリンク「${edge.source}→${edge.target}」は存在しません`,
      });
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
          ? `有効な操作がありません: ${warnings.map((w) => w.message).join(" / ")}`
          : "diff に操作が含まれていません",
      warnings,
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
