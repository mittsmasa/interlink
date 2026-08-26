import { z } from "zod";
import { EDGE_STATUSES, NODE_KINDS, POLARITIES } from "@/db/schema";

/**
 * リビジョンに保存する図の全量。loadDiagramSnapshot の形から projectId を落としたもの
 * （projectId はリビジョン行が持つので、snapshot 側に持たせると復元時に食い違いうる）。
 *
 * 保存済みの JSON は後から列が増えても読めなければならない。列の追加は必ず
 * nullish + default で受けること（既存リビジョンがその列を持たないため）。
 */

/** 後から増えた列を古い snapshot でも読めるようにする受け方 */
const optionalText = z.string().nullish().default(null);
const optionalNumber = z.number().nullish().default(null);

const snapshotNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  memo: optionalText,
  unit: optionalText,
  kind: z.enum(NODE_KINDS).nullish().default(null),
  expression: optionalText,
  initialValue: optionalNumber,
  value: optionalNumber,
  x: optionalNumber,
  y: optionalNumber,
  createdAt: optionalNumber,
  updatedAt: optionalNumber,
});

const snapshotEdgeSchema = z.object({
  id: z.string(),
  sourceNodeId: z.string(),
  targetNodeId: z.string(),
  /** 表示用。ID から引き直せるが、snapshot 単体を読めるように持たせる */
  sourceName: z.string().default(""),
  targetName: z.string().default(""),
  polarity: z.enum(POLARITIES),
  hasDelay: z.boolean().default(false),
  rationale: z.string().default(""),
  status: z.enum(EDGE_STATUSES).default("inferred"),
  createdAt: optionalNumber,
});

export const revisionSnapshotSchema = z.object({
  nodes: z.array(snapshotNodeSchema).default([]),
  edges: z.array(snapshotEdgeSchema).default([]),
});

export type RevisionSnapshot = z.infer<typeof revisionSnapshotSchema>;
export type SnapshotNode = RevisionSnapshot["nodes"][number];
export type SnapshotEdge = RevisionSnapshot["edges"][number];

/** 差分の基点が無いとき（そのプロジェクト最初のリビジョン）に使う空の図 */
export const EMPTY_SNAPSHOT: RevisionSnapshot = { nodes: [], edges: [] };

/** DB から読んだ図をリビジョンに保存する形へ落とす */
export function toRevisionSnapshot(diagram: {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}): RevisionSnapshot {
  return {
    nodes: diagram.nodes.map((n) => ({
      id: n.id,
      name: n.name,
      memo: n.memo ?? null,
      unit: n.unit ?? null,
      kind: n.kind ?? null,
      expression: n.expression ?? null,
      initialValue: n.initialValue ?? null,
      value: n.value ?? null,
      x: n.x ?? null,
      y: n.y ?? null,
      createdAt: n.createdAt ?? null,
      updatedAt: n.updatedAt ?? null,
    })),
    edges: diagram.edges.map((e) => ({
      id: e.id,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceName: e.sourceName,
      targetName: e.targetName,
      polarity: e.polarity,
      hasDelay: e.hasDelay,
      rationale: e.rationale,
      status: e.status,
      createdAt: e.createdAt ?? null,
    })),
  };
}

/**
 * 保存済み JSON を読む。壊れた JSON / スキーマ違反は throw する
 * （空の図として黙って復元すると、復元操作が図の全消去になってしまう）
 */
export function parseRevisionSnapshot(json: string): RevisionSnapshot {
  return revisionSnapshotSchema.parse(JSON.parse(json));
}

export function serializeRevisionSnapshot(snapshot: RevisionSnapshot): string {
  return JSON.stringify(snapshot);
}
