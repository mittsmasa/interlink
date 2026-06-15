import { deriveDependencies, isCausallyLinked } from "./dependencies";

export type LintSeverity = "warning" | "info";

export type LintRule =
  | "direction-in-name"
  | "verb-name"
  | "isolated-node"
  | "missing-dependency-link";

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
};
type LintEdge = { id: string; sourceNodeId: string; targetNodeId: string };

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

  return [...warnings, ...infos];
}
