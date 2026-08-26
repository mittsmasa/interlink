import type { EdgeStatus } from "@/db/schema";
import {
  collectReferencedNames,
  deriveDependencies,
  isCausallyLinked,
} from "./dependencies";
import type { Loop } from "./loops";
import { formatRate, normalizeQuantity, parseUnit } from "./units";

export type LintSeverity = "warning" | "info";

export type LintRule =
  | "direction-in-name"
  | "verb-name"
  | "isolated-node"
  | "missing-dependency-link"
  | "flow-without-stock"
  | "stock-without-flow"
  | "stock-to-stock-edge"
  | "undefined-reference"
  | "speculative-link"
  | "bidirectional-link"
  | "conflicting-link"
  | "unit-mismatch-flow"
  | "unit-missing-on-sfd";

export type LintFinding = {
  rule: LintRule;
  severity: LintSeverity;
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
};

type LintNode = {
  id: string;
  name: string;
  kind?: string | null;
  expression?: string | null;
  unit?: string | null;
};
type LintEdge = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  /** 未指定（旧 fixture 等）は確からしさを判定しない */
  status?: EdgeStatus;
  /** 未指定なら極性の食い違い（conflicting-link）は見ない */
  polarity?: "+" | "-";
};

/**
 * ループ文脈を要するルール（speculative-link）のための追加入力。
 * ループは保存せず毎回導出するため、呼び出し側で detectLoops した結果を渡す
 */
export type LintOptions = {
  loops?: readonly Loop[];
  /** ユーザーが実感で確かめたループ ID（InterviewNotes.confirmedLoopIds） */
  confirmedLoopIds?: readonly string[];
};

/**
 * 変数名に含まれていたら警告する方向語。
 * 誤検知を避けるため保守的に小さく始める（Kim ガイドライン:
 * 変数は増減を語れる中立な名詞句にする）
 */
const DIRECTION_WORDS = [
  "増大",
  "増加",
  "減少",
  "低下",
  "向上",
  "悪化",
  "改善",
  "不足",
  "過多",
  "上昇",
  "下降",
  "拡大",
  "縮小",
];

/**
 * Kim ガイドライン由来の図 lint。警告であってブロックしない。
 * severity: warning = 直したほうがよい / info = 様子見でよい気づき
 */
export function lintDiagram(
  nodes: LintNode[],
  edges: LintEdge[],
  options: LintOptions = {},
): LintFinding[] {
  const warnings: LintFinding[] = [];
  const infos: LintFinding[] = [];

  for (const node of nodes) {
    const direction = DIRECTION_WORDS.find((word) => node.name.includes(word));
    if (direction) {
      const stripped = node.name.replace(direction, "").trim();
      warnings.push({
        rule: "direction-in-name",
        severity: "warning",
        message: stripped
          ? `「${node.name}」は方向を含んでいます。「${stripped}」のように増減を語れる名詞にしては?`
          : `「${node.name}」は方向そのものです。何の増減かを名詞で表しては?`,
        nodeIds: [node.id],
      });
      // 同じノードへの重ね指摘はしない
      continue;
    }
    if (/(する|させる)$/.test(node.name)) {
      warnings.push({
        rule: "verb-name",
        severity: "warning",
        message: `「${node.name}」は動詞で終わっています。増減を語れる名詞句にしては?`,
        nodeIds: [node.id],
      });
    }
  }

  const connectedNodeIds = new Set<string>();
  for (const edge of edges) {
    connectedNodeIds.add(edge.sourceNodeId);
    connectedNodeIds.add(edge.targetNodeId);
  }
  for (const node of nodes) {
    if (!connectedNodeIds.has(node.id)) {
      infos.push({
        rule: "isolated-node",
        severity: "info",
        message: `「${node.name}」はまだどのリンクにも繋がっていません`,
        nodeIds: [node.id],
      });
    }
  }

  warnings.push(...lintStockFlow(nodes, edges));
  warnings.push(...lintConflictingLinks(nodes, edges));

  // 式が他ノードを参照しているのに、図にそのリンク（因果エッジ）が無い依存を気づかせる。
  // 依存の真実は式にあるため（simulate と同様）、式から導出して既存エッジと突き合わせる。
  // 同方向の因果エッジが既にあるものは「図に現れている」ので出さない。
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  for (const dep of deriveDependencies(nodes)) {
    if (isCausallyLinked(dep.fromNodeId, dep.toNodeId, edges)) continue;
    const fromName = nameById.get(dep.fromNodeId) ?? "";
    const toName = nameById.get(dep.toNodeId) ?? "";
    infos.push({
      rule: "missing-dependency-link",
      severity: "info",
      message: `「${toName}」は式で「${fromName}」に依存していますが、図にリンクがありません`,
      nodeIds: [dep.toNodeId],
    });
  }

  infos.push(...lintEdgeStatus(nodes, edges, options));

  const units = lintUnits(nodes, edges);
  warnings.push(...units.warnings);
  infos.push(...units.infos);

  return [...warnings, ...infos];
}

/**
 * SFD（kind 付きノード）の整合ルール。simulate が実行時に黙って無視する・エラーにする
 * 構造を、実行前に warning として出す。kind が null の CLD には何も出さない。
 * - flow-without-stock: flow から stock へのエッジが無い（simulate は flow→stock 以外を無視する）
 * - stock-without-flow: stock に流入/流出する flow が無い（初期値のまま動かない）
 * - stock-to-stock-edge: stock→stock のエッジ（量は flow を通してしか動かない）
 * - undefined-reference: 式がどのノード名にも一致しない変数を参照（実行時エラーになる）
 */
function lintStockFlow(nodes: LintNode[], edges: LintEdge[]): LintFinding[] {
  const findings: LintFinding[] = [];
  const kindById = new Map(nodes.map((n) => [n.id, n.kind ?? null]));
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const names = new Set(nodes.map((n) => n.name));

  const flowsWithStock = new Set<string>();
  const stocksWithFlow = new Set<string>();
  for (const edge of edges) {
    const sourceKind = kindById.get(edge.sourceNodeId);
    const targetKind = kindById.get(edge.targetNodeId);
    if (sourceKind === "flow" && targetKind === "stock") {
      flowsWithStock.add(edge.sourceNodeId);
      stocksWithFlow.add(edge.targetNodeId);
    }
    if (sourceKind === "stock" && targetKind === "stock") {
      findings.push({
        rule: "stock-to-stock-edge",
        severity: "warning",
        message: `「${nameById.get(edge.sourceNodeId)}」→「${nameById.get(edge.targetNodeId)}」は stock 同士のリンクです。stock は flow を通してしか変化しないため、シミュレーションでは無視されます。間に flow を置いては?`,
        edgeIds: [edge.id],
      });
    }
  }

  for (const node of nodes) {
    if (node.kind === "flow" && !flowsWithStock.has(node.id)) {
      findings.push({
        rule: "flow-without-stock",
        severity: "warning",
        message: `flow「${node.name}」から stock へのリンクがありません。どの stock を増減させるかを flow → stock のリンク（+ 流入 / − 流出）で示してください`,
        nodeIds: [node.id],
      });
    }
    if (node.kind === "stock" && !stocksWithFlow.has(node.id)) {
      findings.push({
        rule: "stock-without-flow",
        severity: "warning",
        message: `stock「${node.name}」に流入/流出する flow がありません。初期値のまま変化しないので、増減させる flow を置いては?`,
        nodeIds: [node.id],
      });
    }
    const expr = node.expression?.trim();
    if (!expr) continue;
    const unknown = [
      ...new Set(collectReferencedNames(expr).filter((n) => !names.has(n))),
    ];
    if (unknown.length > 0) {
      findings.push({
        rule: "undefined-reference",
        severity: "warning",
        message: `「${node.name}」の式が図にない変数「${unknown.join("」「")}」を参照しています。変数名を図にある名前に合わせるか、変数を追加してください`,
        nodeIds: [node.id],
      });
    }
  }

  return findings;
}

/**
 * 同じ (source, target) に極性の違うリンクが並んでいる状態を拾う。
 * DB は ペアごとに 1 本の unique index で新規発生を塞いでいるが、lint は DB を経由しない
 * 入力（index 導入前のデータ、取り込み経路、テスト fixture）でも呼ばれる。
 * 極性の矛盾は「どちらが実感に近いか」を確かめるべき論点なので、潰さず対話に載せる。
 */
function lintConflictingLinks(
  nodes: LintNode[],
  edges: LintEdge[],
): LintFinding[] {
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const byPair = new Map<string, LintEdge[]>();
  for (const edge of edges) {
    if (edge.polarity === undefined) continue;
    const key = `${edge.sourceNodeId} ${edge.targetNodeId}`;
    const group = byPair.get(key);
    if (group) {
      group.push(edge);
    } else {
      byPair.set(key, [edge]);
    }
  }

  const findings: LintFinding[] = [];
  for (const group of byPair.values()) {
    if (new Set(group.map((e) => e.polarity)).size < 2) continue;
    const [first] = group;
    findings.push({
      rule: "conflicting-link",
      severity: "warning",
      message: `「${nameById.get(first.sourceNodeId) ?? ""}」→「${nameById.get(first.targetNodeId) ?? ""}」の極性が + と − で食い違っています。どちらが実感に近いですか?`,
      nodeIds: [first.sourceNodeId, first.targetNodeId],
      edgeIds: group.map((e) => e.id),
    });
  }
  return findings;
}

// ============================================================
// リンクの確からしさ・双方向リンク（確認フロー向けのルール）
// ============================================================

/**
 * - speculative-link: status が inferred のまま、確認済みループのどれにも入っていないリンク。
 *   確認済みループが 1 つもない段階では出さない（全リンクが inferred の初期ドラフトで
 *   status の重複表示にしかならないため）
 * - bidirectional-link: A→B と B→A が両方ある。2 ノード R ループになりがちで、
 *   実際は片方が先に動く・間に変数が挟まることが多い
 */
function lintEdgeStatus(
  nodes: LintNode[],
  edges: LintEdge[],
  { loops = [], confirmedLoopIds = [] }: LintOptions,
): LintFinding[] {
  const infos: LintFinding[] = [];
  const nameById = new Map(nodes.map((n) => [n.id, n.name]));
  const nameOf = (id: string) => nameById.get(id) ?? "";

  if (confirmedLoopIds.length > 0) {
    const confirmed = new Set(confirmedLoopIds);
    const confirmedEdgeIds = new Set(
      loops.filter((l) => confirmed.has(l.id)).flatMap((l) => l.edgeIds),
    );
    for (const edge of edges) {
      if (edge.status !== "inferred" || confirmedEdgeIds.has(edge.id)) continue;
      infos.push({
        rule: "speculative-link",
        severity: "info",
        message: `「${nameOf(edge.sourceNodeId)}→${nameOf(edge.targetNodeId)}」は推測のままで、確認済みのループにも入っていません。実感と合うか確かめては?`,
        edgeIds: [edge.id],
      });
    }
  }

  const edgeByPair = new Map(
    edges.map((e) => [`${e.sourceNodeId}→${e.targetNodeId}`, e]),
  );
  const reported = new Set<string>();
  for (const edge of edges) {
    if (edge.sourceNodeId === edge.targetNodeId) continue;
    const reverse = edgeByPair.get(`${edge.targetNodeId}→${edge.sourceNodeId}`);
    if (!reverse || reported.has(reverse.id)) continue;
    reported.add(edge.id);
    const a = nameOf(edge.sourceNodeId);
    const b = nameOf(edge.targetNodeId);
    infos.push({
      rule: "bidirectional-link",
      severity: "info",
      message: `「${a}」と「${b}」が互いに影響し合う 2 変数のループになっています。どちらが先に動きますか? 間に挟まる変数はありませんか?`,
      nodeIds: [edge.sourceNodeId, edge.targetNodeId],
      edgeIds: [edge.id, reverse.id],
    });
  }

  return infos;
}

// ============================================================
// 単位の整合（`unit` 列を読む唯一のルール群）
// ============================================================

/**
 * stock / flow の取り違えは構造ルール（lintStockFlow）では捕まらない。
 * flow と stock を入れ替えても simulate は動いてしまい、積分の意味だけが壊れるため。
 * 単位はその取り違えを外から確かめられる唯一のものさしなので、ここで読む
 * （doc の m3-stock-and-flow.md 4 章「単位に /時間 が付くか」）。
 *
 * - unit-mismatch-flow（warning）: flow → stock で、flow の単位が「stock の単位 / 時間」の
 *   率になっていない
 * - unit-missing-on-sfd（info）: kind が stock / flow なのに単位が無い。整合を確かめる
 *   手がかりが無いことに気づかせる（CLD 段階の kind: null には出さない）
 *
 * 単位は自由文字列なので、判定は確実に言えるときだけに絞る。読めない表記・時間でない分母
 * （units.ts が null を返す）に加え、stock 自身が率のとき（例: 平滑化した成長率「%/年」）も
 * 見送る。その場合フローは「%/年/年」になり、誰もそうは書かないため比べようがない。
 */
function lintUnits(
  nodes: LintNode[],
  edges: LintEdge[],
): { warnings: LintFinding[]; infos: LintFinding[] } {
  const warnings: LintFinding[] = [];
  const infos: LintFinding[] = [];
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  for (const edge of edges) {
    const flow = nodeById.get(edge.sourceNodeId);
    const stock = nodeById.get(edge.targetNodeId);
    if (flow?.kind !== "flow" || stock?.kind !== "stock") continue;

    const flowUnit = parseUnit(flow.unit);
    const stockUnit = parseUnit(stock.unit);
    if (!flowUnit || !stockUnit || stockUnit.per) continue;

    // 期待する率の見本。フロー側に時間の分母があればその時間単位に合わせて見せる
    const expected = formatRate(stockUnit.quantity, flowUnit.per?.raw ?? "日");
    if (!flowUnit.per) {
      warnings.push({
        rule: "unit-mismatch-flow",
        severity: "warning",
        message: `「${flow.name}」の単位が「${flow.unit}」ですが、ストック「${stock.name}」（単位: ${stock.unit}）を動かすフローは「${expected}」のような率（ストックの単位 / 時間）になっているはずです。時点の量なら kind は stock では?`,
        nodeIds: [flow.id],
        edgeIds: [edge.id],
      });
      continue;
    }
    if (
      normalizeQuantity(flowUnit.quantity) !==
      normalizeQuantity(stockUnit.quantity)
    ) {
      warnings.push({
        rule: "unit-mismatch-flow",
        severity: "warning",
        message: `「${flow.name}」の単位「${flow.unit}」は、動かすストック「${stock.name}」（単位: ${stock.unit}）と量が違います。「${expected}」のような率になっているはずです。別の量ならこのリンクは flow → stock ではないのでは?`,
        nodeIds: [flow.id],
        edgeIds: [edge.id],
      });
    }
  }

  for (const node of nodes) {
    if (node.kind !== "stock" && node.kind !== "flow") continue;
    if (node.unit?.trim()) continue;
    infos.push({
      rule: "unit-missing-on-sfd",
      severity: "info",
      message:
        node.kind === "stock"
          ? `stock「${node.name}」に単位がありません。「ポイント」「人」のような時点の量を付けると、出入りするフローとの整合を確かめられます`
          : `flow「${node.name}」に単位がありません。「ポイント/日」のような「ストックの単位 / 時間」の率を付けると、動かすストックとの整合を確かめられます`,
      nodeIds: [node.id],
    });
  }

  return { warnings, infos };
}
