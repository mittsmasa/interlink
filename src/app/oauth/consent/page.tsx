import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/session";
import { ConsentForm } from "./_components/consent-form";

/** スコープ ID をそのまま見せても判断できないので、日本語の説明に置き換える */
const SCOPE_LABELS: Record<string, string> = {
  openid: "アカウントの識別",
  profile: "名前とプロフィール画像",
  email: "メールアドレス",
  offline_access: "継続的なアクセス（再ログインなしでの更新）",
};

/**
 * searchParams をクエリ文字列へ戻す。
 * 署名付きクエリは ba_param を多値で持つが、`new URLSearchParams(record)` は
 * 配列を "a,b" に潰してしまうため、[key, value] の列に開いてから渡す
 */
function toQueryString(
  params: Record<string, string | string[] | undefined>,
): string {
  const entries = Object.entries(params).flatMap(([key, value]) =>
    Array.isArray(value)
      ? value.map((v): [string, string] => [key, v])
      : value === undefined
        ? []
        : [[key, value] as [string, string]],
  );
  return new URLSearchParams(entries).toString();
}

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const clientId = typeof params.client_id === "string" ? params.client_id : "";
  const scope = typeof params.scope === "string" ? params.scope : "";

  const session = await getSession();
  if (!session) {
    // 認可フローの署名付きクエリを保ったままログインさせる。
    // ログイン成功時に oauth-provider の after フックが認可を再開する
    redirect(`/login?${toQueryString(params)}`);
  }

  const client = clientId
    ? await auth.api
        .getOAuthClientPublic({
          query: { client_id: clientId },
          headers: await headers(),
        })
        .catch(() => null)
    : null;

  if (!client) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
        <h1 className="font-display text-4xl tracking-tight">interlink</h1>
        <p className="text-muted-foreground">
          リクエストが不正です。接続元のアプリからやり直してください。
        </p>
      </main>
    );
  }

  // scope 未指定でも認可自体は成立するので、既定の説明を出す
  const scopes = scope.split(" ").filter(Boolean);
  const scopeLabels = scopes.length
    ? scopes.map((s) => SCOPE_LABELS[s] ?? s)
    : ["アカウントの識別"];
  const clientName = client.client_name ?? "外部のアプリ";

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <h1 className="font-display text-4xl tracking-tight">interlink</h1>
      <p className="max-w-sm text-center leading-relaxed">
        <span className="font-medium">{clientName}</span> が
        あなたのアカウントへのアクセスを求めています
      </p>

      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col gap-3">
          <p className="text-muted-foreground text-sm">許可される内容</p>
          <ul className="flex flex-col gap-2 text-sm">
            {scopeLabels.map((label) => (
              <li key={label} className="flex gap-2">
                <span aria-hidden="true" className="text-muted-foreground">
                  ・
                </span>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <ConsentForm />

      <p className="text-muted-foreground text-xs">
        {session.user.email} としてログイン中
      </p>
    </main>
  );
}
