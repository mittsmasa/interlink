import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginButton } from "./_components/login-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // OAuth の authorize から送られてきた場合、クエリに署名付きパラメータが載る。
  // このときはログイン済みでもトップへ飛ばさない（認可フローが中断してしまう）。
  // ログインが完了すると oauth-provider の after フックが認可を自動で再開する
  const isOAuthContinuation =
    typeof params.client_id === "string" && typeof params.sig === "string";

  const session = await getSession();
  if (session && !isOAuthContinuation) {
    redirect("/");
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-display text-5xl tracking-tight">interlink</h1>
        <p className="text-muted-foreground">
          {isOAuthContinuation
            ? "接続を続けるにはログインしてください。"
            : "問いの構造を、図にする。"}
        </p>
      </div>
      <LoginButton />
    </main>
  );
}
