import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";

/**
 * プロジェクトの削除・改名。Web の server action と MCP ツールの両方から呼ぶ。
 * 所有権チェックは where に userId を含める形で行い、他人の ID を渡されても
 * 何も起きない（存在の有無も漏らさない）。
 * 削除は projects の FK cascade で messages / nodes / edges も消える。
 */

/** 所有プロジェクトを削除する。削除できたら true、見つからなければ false */
export async function deleteOwnedProject(projectId: string, userId: string) {
  const deleted = await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ id: projects.id });
  return deleted.length > 0;
}

export type RenameProjectResult =
  | { ok: true; title: string }
  | { ok: false; reason: "not-found" | "empty-title" };

/** 所有プロジェクトのタイトルを変える。前後の空白は落とし、空文字は拒否する */
export async function renameOwnedProject(
  projectId: string,
  userId: string,
  title: string,
): Promise<RenameProjectResult> {
  const trimmed = title.trim();
  if (!trimmed) return { ok: false, reason: "empty-title" };
  const updated = await db
    .update(projects)
    .set({ title: trimmed, updatedAt: Date.now() })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning({ title: projects.title });
  if (updated.length === 0) return { ok: false, reason: "not-found" };
  return { ok: true, title: updated[0].title };
}
