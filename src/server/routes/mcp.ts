import { StreamableHTTPTransport } from "@hono/mcp";
import { Hono } from "hono";
import { auth } from "@/lib/auth";
import { buildMcpServer } from "@/lib/mcp/tools";

/**
 * 外部エージェント向け MCP エンドポイント（Streamable HTTP）。
 * 認証は API キー（x-api-key ヘッダ）。better-auth の apiKey プラグインが
 * getSession でキーをセッションへ解決する。
 * Vercel serverless のためセッション ID を持たない stateless 運用とし、
 * リクエストごとにサーバー・トランスポートを生成して使い捨てる。
 */
export const mcpRoute = new Hono().all("/", async (c) => {
  // 無効・失効キーでは apiKey プラグインの hook が APIError を throw するため、
  // 例外もセッションなしと同様に 401 へ落とす
  const session = await auth.api
    .getSession({ headers: c.req.raw.headers })
    .catch(() => null);
  if (!session) {
    return c.json(
      {
        error: "認証が必要です。x-api-key ヘッダに API キーを指定してください",
      },
      401,
    );
  }

  const server = buildMcpServer(session.user.id);
  const transport = new StreamableHTTPTransport({
    // stateless: セッション ID を発行せず、initialize を毎リクエスト受け付ける
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(c);
});
