import "server-only";
import type { UIMessage } from "ai";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";

/**
 * チャット完了時に UIMessage 一式を保存する。
 * UIMessage の id を主キーにした upsert なので、既存分は触らず
 * 新しい user / assistant メッセージだけが増える。
 */
export async function saveMessages(projectId: string, uiMessages: UIMessage[]) {
  const rows = uiMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      projectId,
      role: m.role as "user" | "assistant",
      parts: JSON.stringify(m.parts),
    }));
  if (rows.length === 0) return;

  await db
    .insert(messages)
    .values(rows)
    .onConflictDoUpdate({
      target: messages.id,
      set: { parts: sql`excluded.parts` },
    });
}

/** DB の行を UIMessage に復元する */
export function toUIMessage(row: {
  id: string;
  role: "user" | "assistant";
  parts: string;
}): UIMessage {
  return {
    id: row.id,
    role: row.role,
    parts: JSON.parse(row.parts),
  };
}
