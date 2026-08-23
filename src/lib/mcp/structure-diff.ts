import type { LintFinding } from "@/lib/diagram/lint";
import type { Loop } from "@/lib/diagram/loops";

/** 応答に載せるループの要約（get_diagram の loops 形状とは独立） */
export type LoopSummary = {
  id: string;
  label: string;
  polarity: Loop["polarity"];
  nodeNames: string[];
};

export type StructureDiff = {
  /** 適用で新たに閉じたループ */
  closedLoops: LoopSummary[];
  /** 適用で消えた（開いた）ループ */
  openedLoops: LoopSummary[];
  /** 適用で新たに出た lint 指摘 */
  newFindings: LintFinding[];
};

export type StructureSnapshot = {
  loops: Loop[];
  findings: LintFinding[];
};

function summarize(loop: Loop): LoopSummary {
  return {
    id: loop.id,
    label: loop.label,
    polarity: loop.polarity,
    nodeNames: loop.nodeNames,
  };
}

/**
 * lint 指摘の同一性キー。nodeIds / edgeIds は適用で付け替わらない
 * （更新は ID を保つ）ので、rule + 対象 ID で同じ指摘とみなす
 */
function findingKey(f: LintFinding) {
  return [f.rule, ...(f.nodeIds ?? []), ...(f.edgeIds ?? [])].join("|");
}

/**
 * 適用前後の構造を比べる。ループは detectLoops が返す決定的な id
 * （回転正規化したノード ID 列）で同一視する
 */
export function diffStructure(
  before: StructureSnapshot,
  after: StructureSnapshot,
): StructureDiff {
  const beforeLoopIds = new Set(before.loops.map((l) => l.id));
  const afterLoopIds = new Set(after.loops.map((l) => l.id));
  const beforeFindingKeys = new Set(before.findings.map(findingKey));
  return {
    closedLoops: after.loops
      .filter((l) => !beforeLoopIds.has(l.id))
      .map(summarize),
    openedLoops: before.loops
      .filter((l) => !afterLoopIds.has(l.id))
      .map(summarize),
    newFindings: after.findings.filter(
      (f) => !beforeFindingKeys.has(findingKey(f)),
    ),
  };
}
