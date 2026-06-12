import { db } from "@/db";
import { projects, users } from "@/db/schema";

let seq = 0;

export async function createUser(overrides: Partial<{ name: string }> = {}) {
  seq += 1;
  const now = new Date();
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      name: overrides.name ?? `テストユーザー${seq}`,
      email: `test-${seq}-${crypto.randomUUID()}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return user;
}

export async function createProject(
  userId: string,
  overrides: Partial<{ title: string }> = {},
) {
  const [project] = await db
    .insert(projects)
    .values({
      userId,
      title: overrides.title ?? "テストプロジェクト",
    })
    .returning();
  return project;
}
