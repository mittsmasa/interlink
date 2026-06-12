"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { requireSession } from "@/lib/session";

export async function createProject() {
  const session = await requireSession();
  const [project] = await db
    .insert(projects)
    .values({
      userId: session.user.id,
      title: "新しい対話",
    })
    .returning();
  redirect(`/projects/${project.id}`);
}

export async function deleteProject(projectId: string) {
  const session = await requireSession();
  await db
    .delete(projects)
    .where(
      and(eq(projects.id, projectId), eq(projects.userId, session.user.id)),
    );
  revalidatePath("/");
}
