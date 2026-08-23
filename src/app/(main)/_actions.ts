"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { deleteOwnedProject } from "@/lib/projects/manage";
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
  await deleteOwnedProject(projectId, session.user.id);
  revalidatePath("/");
}
