import "server-only";
import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { messages } from "@/db/schema";

/** プロジェクトのチャット履歴（古い順） */
export const getMessagesByProjectId = cache(async (projectId: string) => {
  return db.query.messages.findMany({
    where: eq(messages.projectId, projectId),
    orderBy: [asc(messages.createdAt)],
  });
});
