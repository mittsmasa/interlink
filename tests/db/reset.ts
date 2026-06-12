import { db } from "@/db";
import { edges, messages, nodes, projects, users } from "@/db/schema";

/** 全テーブルを空にする（外部キーの依存順に削除） */
export async function resetDb() {
  await db.delete(edges);
  await db.delete(nodes);
  await db.delete(messages);
  await db.delete(projects);
  await db.delete(users);
}
