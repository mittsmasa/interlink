import { db } from "@/db";
import {
  apikeys,
  diagramRevisions,
  edges,
  messages,
  nodes,
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  projects,
  users,
} from "@/db/schema";

/** 全テーブルを空にする（外部キーの依存順に削除） */
export async function resetDb() {
  await db.delete(edges);
  await db.delete(nodes);
  await db.delete(messages);
  await db.delete(diagramRevisions);
  await db.delete(projects);
  await db.delete(oauthAccessTokens);
  await db.delete(oauthRefreshTokens);
  await db.delete(oauthConsents);
  await db.delete(oauthClients);
  await db.delete(apikeys);
  await db.delete(users);
}
