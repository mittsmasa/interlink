import { StreamableHTTPTransport } from "@hono/mcp";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import { Hono } from "hono";
import { auth } from "@/lib/auth";
import {
  authBaseUrl,
  mcpResourceMetadataUrl,
  mcpResourceUrl,
} from "@/lib/base-url";
import { buildMcpServer } from "@/lib/mcp/tools";

/**
 * jwksFetch に関数を渡すと毎回の検証で再取得されるため、
 * TTL キャッシュのキーになる安定オブジェクトを 1 つ用意しておく
 */
const jwksCacheKey = {};

/** OAuth アクセストークン（JWT）を検証して所有ユーザー ID を返す */
async function userIdFromBearer(token: string) {
  const payload = await verifyJwsAccessToken(token, {
    // 同一アプリ内なので HTTP 往復せず jwks を直接引く
    jwksFetch: () => auth.api.getJwks(),
    jwksCacheKey,
    verifyOptions: { issuer: authBaseUrl, audience: mcpResourceUrl },
  }).catch(() => null);
  return typeof payload?.sub === "string" ? payload.sub : null;
}

/**
 * 外部エージェント向け MCP エンドポイント（Streamable HTTP）。
 * 認証は 2 系統:
 * - `Authorization: Bearer <JWT>`: OAuth 2.1 で発行したアクセストークン
 *   （claude.ai のカスタムコネクタなど、ヘッダ認証を持たないクライアント向け）
 * - `x-api-key`: better-auth の apiKey プラグインが getSession でキーを解決する
 *
 * Vercel serverless のためセッション ID を持たない stateless 運用とし、
 * リクエストごとにサーバー・トランスポートを生成して使い捨てる。
 */
export const mcpRoute = new Hono().all("/", async (c) => {
  const bearer = c.req
    .header("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();

  // 無効・失効キーでは apiKey プラグインの hook が APIError を throw するため、
  // 例外もセッションなしと同様に 401 へ落とす
  const userId = bearer
    ? await userIdFromBearer(bearer)
    : ((
        await auth.api
          .getSession({ headers: c.req.raw.headers })
          .catch(() => null)
      )?.user.id ?? null);

  if (!userId) {
    return c.json(
      {
        error:
          "認証が必要です。OAuth のアクセストークン（Authorization: Bearer）か x-api-key ヘッダを指定してください",
      },
      401,
      // RFC 9728: 認可サーバーの発見に必要なメタデータ URL を教える
      {
        "WWW-Authenticate": `Bearer resource_metadata="${mcpResourceMetadataUrl}"`,
      },
    );
  }

  const server = buildMcpServer(userId);
  const transport = new StreamableHTTPTransport({
    // stateless: セッション ID を発行せず、initialize を毎リクエスト受け付ける
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(c);
});
