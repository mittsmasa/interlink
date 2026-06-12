"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { edges, nodes, type Polarity, projects } from "@/db/schema";
import { normalizeName } from "@/lib/diagram/apply-diff";
import { requireSession } from "@/lib/session";

/** プロジェクトの所有を確認して返す。他人のものなら null */
async function getOwnedProject(projectId: string) {
  const session = await requireSession();
  const project = await db.query.projects.findFirst({
    where: and(
      eq(projects.id, projectId),
      eq(projects.userId, session.user.id),
    ),
  });
  return project;
}

async function touchProject(projectId: string) {
  await db
    .update(projects)
    .set({ updatedAt: Date.now() })
    .where(eq(projects.id, projectId));
  revalidatePath(`/projects/${projectId}`);
}

export async function updateProjectTitle(projectId: string, title: string) {
  const project = await getOwnedProject(projectId);
  const trimmed = title.trim();
  if (!project || !trimmed) return { ok: false as const };
  await db
    .update(projects)
    .set({ title: trimmed, updatedAt: Date.now() })
    .where(eq(projects.id, projectId));
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  return { ok: true as const };
}

export async function updateNodePosition(
  projectId: string,
  nodeId: string,
  x: number,
  y: number,
) {
  const project = await getOwnedProject(projectId);
  if (!project) return { ok: false as const };
  await db
    .update(nodes)
    .set({ x, y })
    .where(and(eq(nodes.id, nodeId), eq(nodes.projectId, projectId)));
  // 位置はドラッグのたびに変わる。一覧の並びを乱さないよう updatedAt は触らない
  return { ok: true as const };
}

export async function updateNode(
  projectId: string,
  nodeId: string,
  input: { name: string; memo: string; unit: string },
) {
  const project = await getOwnedProject(projectId);
  const name = input.name.trim();
  if (!project || !name) return { ok: false as const, error: "名前は必須です" };

  // 同名変数の重複を防ぐ（表記ゆれ込みで照合）
  const siblings = await db.query.nodes.findMany({
    where: and(eq(nodes.projectId, projectId), ne(nodes.id, nodeId)),
    columns: { name: true },
  });
  if (siblings.some((s) => normalizeName(s.name) === normalizeName(name))) {
    return { ok: false as const, error: `変数「${name}」は既にあります` };
  }

  await db
    .update(nodes)
    .set({
      name,
      memo: input.memo.trim() || null,
      unit: input.unit.trim() || null,
    })
    .where(and(eq(nodes.id, nodeId), eq(nodes.projectId, projectId)));
  await touchProject(projectId);
  return { ok: true as const };
}

export async function deleteNode(projectId: string, nodeId: string) {
  const project = await getOwnedProject(projectId);
  if (!project) return { ok: false as const };
  // FK cascade で接続エッジも消える
  await db
    .delete(nodes)
    .where(and(eq(nodes.id, nodeId), eq(nodes.projectId, projectId)));
  await touchProject(projectId);
  return { ok: true as const };
}

export async function updateEdge(
  projectId: string,
  edgeId: string,
  input: { polarity: Polarity; hasDelay: boolean; rationale: string },
) {
  const project = await getOwnedProject(projectId);
  if (!project) return { ok: false as const };
  await db
    .update(edges)
    .set({
      polarity: input.polarity,
      hasDelay: input.hasDelay,
      rationale: input.rationale.trim(),
    })
    .where(and(eq(edges.id, edgeId), eq(edges.projectId, projectId)));
  await touchProject(projectId);
  return { ok: true as const };
}

export async function deleteEdge(projectId: string, edgeId: string) {
  const project = await getOwnedProject(projectId);
  if (!project) return { ok: false as const };
  await db
    .delete(edges)
    .where(and(eq(edges.id, edgeId), eq(edges.projectId, projectId)));
  await touchProject(projectId);
  return { ok: true as const };
}
