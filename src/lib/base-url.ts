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
 * アプリの公開オリジン。
 * OAuth の issuer / audience / メタデータ URL はすべてここから導出し、
 * preview デプロイごとに変わるホスト名との不整合を防ぐ。
 */
export const appOrigin = isPreview
  ? (previewBranchUrl ?? previewDeploymentUrl ?? "http://localhost:3000")
  : (process.env.BETTER_AUTH_URL ?? "http://localhost:3000");

/** better-auth のハンドラがマウントされている基底 URL = OAuth の issuer */
export const authBaseUrl = `${appOrigin}/api/auth`;

/** MCP エンドポイント URL = OAuth アクセストークンの audience（resource） */
export const mcpResourceUrl = `${appOrigin}/api/mcp`;

/**
 * RFC 9728 の保護リソースメタデータ URL。
 * 401 応答の WWW-Authenticate ヘッダでクライアントに認可サーバーを教える
 */
export const mcpResourceMetadataUrl = `${appOrigin}/.well-known/oauth-protected-resource/api/mcp`;
