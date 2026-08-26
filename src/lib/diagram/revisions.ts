import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import { type DbClient, db } from "@/db";
import {
  diagramRevisions,
  edges,
  nodes,
  projects,
  type RevisionSource,
} from "@/db/schema";
import {
  describeRevisionDiff,
  diffRevisions,
  type RevisionDiff,
} from "./revision-diff";
import {
  EMPTY_SNAPSHOT,
  parseRevisionSnapshot,
  type RevisionSnapshot,
  serializeRevisionSnapshot,
  toRevisionSnapshot,
} from "./revision-snapshot";
import { loadDiagramSnapshotWith } from "./snapshot";

/** プロジェクトあたりの保持件数。超えた古い順に purge する */
export const MAX_REVISIONS_PER_PROJECT = 50;

/** list_revisions が一度に返す既定件数 */
export const DEFAULT_REVISION_LIST_LIMIT = 20;

export type RevisionListItem = {
  id: number;
  createdAt: number;
  source: RevisionSource;
  summary: string;
};

/**
 * 直近のリビジョンを 1 行返す。
 * id はテーブル全体の autoincrement（プロジェクト単位ではない）ため、
 * projectId で必ず絞り込む。絞り込みを落とすと、他プロジェクトの方が新しい id を
 * 持つときにそちらの snapshot を差分の基点にしてしまう
 */
async function findLatestRevision(client: DbClient, projectId: string) {
  const rows = await client
    .select({ id: diagramRevisions.id, snapshot: diagramRevisions.snapshot })
    .from(diagramRevisions)
    .where(eq(diagramRevisions.projectId, projectId))
    .orderBy(desc(diagramRevisions.id))
    .limit(1);
  return rows[0];
}

/**
 * 差分の基点を読む。保存済み JSON が壊れていても新しいリビジョンの保存は
 * 止めない（基点を空として summary が大きく出るだけで、履歴は積まれる方が良い）
 */
function parseBaseSnapshot(json: string): RevisionSnapshot {
  try {
    return parseRevisionSnapshot(json);
  } catch {
    return EMPTY_SNAPSHOT;
  }
}

/** 保持件数を超えた古いリビジョンを消す。消した件数を返す */
async function purgeOldRevisions(client: DbClient, projectId: string) {
  const kept = await client
    .select({ id: diagramRevisions.id })
    .from(diagramRevisions)
    .where(eq(diagramRevisions.projectId, projectId))
    .orderBy(desc(diagramRevisions.id))
    .limit(MAX_REVISIONS_PER_PROJECT);
  if (kept.length < MAX_REVISIONS_PER_PROJECT) return 0;
  const oldestKeptId = kept[kept.length - 1].id;
  // id はテーブル全体の autoincrement なので projectId の絞り込みが必須。
  // 落とすと自分の purge が他プロジェクトの古いリビジョンまで消す
  const deleted = await client
    .delete(diagramRevisions)
    .where(
      and(
        eq(diagramRevisions.projectId, projectId),
        lt(diagramRevisions.id, oldestKeptId),
      ),
    )
    .returning({ id: diagramRevisions.id });
  return deleted.length;
}

/**
 * 適用後の図をリビジョンとして 1 行積む。
 *
 * summary は MutationPlan ではなく「直前のリビジョンとの差分」から作る。
 * plan を持たない UI 経路も同じ関数で扱えて、plan の形が変わっても壊れないため。
 * 図を変える書き込みと同じトランザクション内で呼ぶこと（履歴だけ欠けるのを防ぐ）。
 */
export async function saveRevision(
  client: DbClient,
  projectId: string,
  options: { source: RevisionSource; label?: string },
) {
  const after = toRevisionSnapshot(
    await loadDiagramSnapshotWith(client, projectId),
  );
  const latest = await findLatestRevision(client, projectId);
  const base = latest ? parseBaseSnapshot(latest.snapshot) : EMPTY_SNAPSHOT;
  const described = describeRevisionDiff(diffRevisions(base, after));
  const summary = options.label ? `${options.label}: ${described}` : described;

  const [row] = await client
    .insert(diagramRevisions)
    .values({
      projectId,
      source: options.source,
      summary,
      snapshot: serializeRevisionSnapshot(after),
    })
    .returning({
      id: diagramRevisions.id,
      createdAt: diagramRevisions.createdAt,
    });
  const purged = await purgeOldRevisions(client, projectId);
  return { id: row.id, createdAt: row.createdAt, summary, purged };
}

/** プロジェクトのリビジョンを新しい順に返す */
export async function listRevisions(
  projectId: string,
  limit = DEFAULT_REVISION_LIST_LIMIT,
): Promise<RevisionListItem[]> {
  return db
    .select({
      id: diagramRevisions.id,
      createdAt: diagramRevisions.createdAt,
      source: diagramRevisions.source,
      summary: diagramRevisions.summary,
    })
    .from(diagramRevisions)
    .where(eq(diagramRevisions.projectId, projectId))
    .orderBy(desc(diagramRevisions.id))
    .limit(Math.min(limit, MAX_REVISIONS_PER_PROJECT));
}

/** プロジェクトに属するリビジョンを 1 件返す。他プロジェクトの id では null */
export async function getRevision(projectId: string, revisionId: number) {
  const row = await db.query.diagramRevisions.findFirst({
    where: and(
      eq(diagramRevisions.id, revisionId),
      eq(diagramRevisions.projectId, projectId),
    ),
  });
  return row ?? null;
}

/** 現在の図をリビジョンと同じ形で読む（diff_revisions の to 省略時に使う） */
export async function loadCurrentSnapshot(projectId: string) {
  return toRevisionSnapshot(await loadDiagramSnapshotWith(db, projectId));
}

export type RestoreResult =
  | { ok: false; reason: "not-found" }
  | {
      ok: true;
      /** 復元によって図がどう変わったか（現在 → 復元先） */
      diff: RevisionDiff;
      restoredFrom: RevisionListItem;
      /** 復元操作そのものを記録した新しいリビジョン */
      revision: { id: number; createdAt: number; summary: string };
    };

/**
 * リビジョンの内容で現在の図を全置換する。
 *
 * ノード / エッジは元の ID のまま入れ直す。ID が保たれるのでループ id も復元され、
 * 復元の前後で差分計算が一貫する。復元自体も新しいリビジョンとして積むので
 * 「戻したことを戻す」ができ、履歴は消えない。
 */
export async function restoreRevision(
  projectId: string,
  revisionId: number,
): Promise<RestoreResult> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(diagramRevisions)
      .where(
        and(
          eq(diagramRevisions.id, revisionId),
          eq(diagramRevisions.projectId, projectId),
        ),
      )
      .limit(1);
    const target = rows[0];
    if (!target) return { ok: false as const, reason: "not-found" as const };

    // 壊れた JSON はここで throw させる。空の図として黙って進むと復元が全消去になる
    const snapshot = parseRevisionSnapshot(target.snapshot);
    const current = toRevisionSnapshot(
      await loadDiagramSnapshotWith(tx, projectId),
    );
    const diff = diffRevisions(current, snapshot);

    const now = Date.now();
    await tx.delete(edges).where(eq(edges.projectId, projectId));
    await tx.delete(nodes).where(eq(nodes.projectId, projectId));
    if (snapshot.nodes.length > 0) {
      await tx.insert(nodes).values(
        snapshot.nodes.map((n) => ({
          id: n.id,
          projectId,
          name: n.name,
          memo: n.memo,
          unit: n.unit,
          kind: n.kind,
          expression: n.expression,
          initialValue: n.initialValue,
          value: n.value,
          x: n.x,
          y: n.y,
          createdAt: n.createdAt ?? now,
          updatedAt: n.updatedAt ?? now,
        })),
      );
    }
    // snapshot 内に端点を持たないエッジは FK で落ちるため除く（壊れた snapshot 対策）
    const nodeIds = new Set(snapshot.nodes.map((n) => n.id));
    const restorableEdges = snapshot.edges.filter(
      (e) => nodeIds.has(e.sourceNodeId) && nodeIds.has(e.targetNodeId),
    );
    if (restorableEdges.length > 0) {
      await tx.insert(edges).values(
        restorableEdges.map((e) => ({
          id: e.id,
          projectId,
          sourceNodeId: e.sourceNodeId,
          targetNodeId: e.targetNodeId,
          polarity: e.polarity,
          hasDelay: e.hasDelay,
          rationale: e.rationale,
          status: e.status,
          createdAt: e.createdAt ?? now,
        })),
      );
    }

    await tx
      .update(projects)
      .set({
        updatedAt: now,
        ...(snapshot.nodes.length > 0
          ? { status: "diagramming" as const }
          : {}),
      })
      .where(eq(projects.id, projectId));

    const revision = await saveRevision(tx, projectId, {
      source: "mcp",
      label: `復元 #${revisionId}`,
    });
    return {
      ok: true as const,
      diff,
      restoredFrom: {
        id: target.id,
        createdAt: target.createdAt,
        source: target.source,
        summary: target.summary,
      },
      revision: {
        id: revision.id,
        createdAt: revision.createdAt,
        summary: revision.summary,
      },
    };
  });
}
