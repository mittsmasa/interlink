import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";

/** 現在のセッションを取得する。未ログインなら null */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** セッションを要求する。未ログインならログインページへリダイレクト */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}
