import { isPreview } from "@/lib/env";

const withHttps = (host: string | undefined) =>
  host ? `https://${host}` : undefined;

const previewBranchUrl = withHttps(process.env.VERCEL_BRANCH_URL);
const previewDeploymentUrl = withHttps(process.env.VERCEL_URL);

/** preview デプロイで信頼するオリジン（ブランチ URL / デプロイ URL） */
export const previewTrustedOrigins = [
  previewBranchUrl,
  previewDeploymentUrl,
].filter((v): v is string => Boolean(v));

/**
 * 実際に listen しているポートから組み立てるオリジン。
 * `next dev` は listening 時、`-p` 指定でも 3000 が埋まっての auto-increment でも、
 * 実際に bind したポートを `process.env.PORT` へ書き戻す
 * （next/dist/server/lib/start-server.js の listening ハンドラ）。
 * ここを読めば起動ポートに自動で追随する。
 */
const portOrigin = `http://localhost:${process.env.PORT ?? 3000}`;

/**
 * アプリの公開オリジン。
 * OAuth の issuer / audience / メタデータ URL はすべてここから導出し、
 * ホスト名・ポートとの不整合を防ぐ。
 *
 * preview 経路（Vercel preview / ローカルの `pnpm dev:preview`）で
 * `BETTER_AUTH_URL` を見ないのは意図的。あれは「このオリジンに固定する」という宣言なので、
 * 実際の起動ポートより先に勝ってしまい、「画面は出るがログインだけ別ポートへ飛ぶ」
 * という気づきにくい壊れ方を作る。ポートが動く preview 経路では参照しない。
 * 明示固定が要るのは production（Vercel の env）と、Google Cloud Console に
 * redirect_uri を登録済みの `pnpm dev` の側だけ。
 */
export const appOrigin = isPreview
  ? (previewBranchUrl ??
    previewDeploymentUrl ??
    process.env.PORTLESS_URL ??
    portOrigin)
  : (process.env.BETTER_AUTH_URL ?? portOrigin);

/** better-auth のハンドラがマウントされている基底 URL = OAuth の issuer */
export const authBaseUrl = `${appOrigin}/api/auth`;

/** MCP エンドポイント URL = OAuth アクセストークンの audience（resource） */
export const mcpResourceUrl = `${appOrigin}/api/mcp`;

/**
 * RFC 9728 の保護リソースメタデータ URL。
 * 401 応答の WWW-Authenticate ヘッダでクライアントに認可サーバーを教える
 */
export const mcpResourceMetadataUrl = `${appOrigin}/.well-known/oauth-protected-resource/api/mcp`;
