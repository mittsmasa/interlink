import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/auth";

/**
 * RFC 8414 の認可サーバーメタデータ（ルート直下）。
 * issuer は `{origin}/api/auth` だが、MCP auth spec 2025-03-26 のクライアントは
 * リソースの origin 直下しか見ないため、こちらにも同じ内容を配信する。
 * Access-Control-Allow-Origin はブラウザで動く MCP クライアント（Inspector 等）向け
 */
export const GET = oauthProviderAuthServerMetadata(auth, {
  headers: { "Access-Control-Allow-Origin": "*" },
});
