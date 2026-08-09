import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/auth";

/**
 * RFC 8414 の認可サーバーメタデータ（issuer パスを挿入した形式）。
 * issuer が `{origin}/api/auth` なので、仕様準拠のクライアントは
 * `/.well-known/oauth-authorization-server/api/auth` を参照する
 */
export const GET = oauthProviderAuthServerMetadata(auth, {
  headers: { "Access-Control-Allow-Origin": "*" },
});
