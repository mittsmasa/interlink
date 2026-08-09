import { authBaseUrl, mcpResourceUrl } from "@/lib/base-url";

/**
 * RFC 9728 の保護リソースメタデータ。
 * /api/mcp が返す 401 の WWW-Authenticate ヘッダから辿られ、
 * どの認可サーバーでトークンを取ればよいかをクライアントに伝える。
 * oauth-provider プラグインはこの形式を提供しないため手書きする
 */
export function GET() {
  return Response.json(
    {
      resource: mcpResourceUrl,
      authorization_servers: [authBaseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "profile", "email", "offline_access"],
    },
    {
      headers: {
        "Cache-Control": "public, max-age=15, stale-while-revalidate=15",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
