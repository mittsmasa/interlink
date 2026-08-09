import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, jwt } from "better-auth/plugins";
import { db } from "@/db";
import * as schema from "@/db/schema";
import {
  appOrigin,
  mcpResourceUrl,
  previewTrustedOrigins,
} from "@/lib/base-url";
import { isPreview } from "@/lib/env";

const googleClientId = process.env.GOOGLE_CLIENT_ID ?? "emulate-client";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "emulate-secret";

/**
 * 外部エージェント（MCP クライアント）向けの API キー認証。
 * enableSessionForAPIKeys により x-api-key ヘッダ付きリクエストで
 * auth.api.getSession がセッションを解決できる
 */
const apiKeyPlugin = apiKey({
  defaultPrefix: "ilk_",
  enableSessionForAPIKeys: true,
});

/**
 * OAuth 2.1 Provider。claude.ai のカスタムコネクタのように
 * Bearer トークンしか扱えない MCP クライアント向け。
 * DCR（RFC 7591）で未認証のクライアント自己登録を許可する必要がある。
 * jwt プラグインは oauthProvider の必須依存（署名鍵の管理）。
 * validAudiences に MCP エンドポイントを入れることで、resource パラメータ付きの
 * 認可リクエストが JWT アクセストークンを受け取れる
 */
const oauthProviderPlugins = [
  jwt(),
  oauthProvider({
    loginPage: "/login",
    consentPage: "/oauth/consent",
    validAudiences: [mcpResourceUrl],
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
    // メタデータは src/app/.well-known/ 配下の route handler で配信済み
    silenceWarnings: { oauthAuthServerConfig: true },
  }),
];

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
    usePlural: true,
  }),
  // OAuth の issuer は baseURL から決まるため、環境によらず明示する。
  // oauthProvider は init 時に issuer を URL としてパースするので、
  // baseURL 未設定（リクエスト由来の解決）だと起動時に落ちる
  baseURL: appOrigin,
  ...(isPreview
    ? {
        trustedOrigins: previewTrustedOrigins,
        plugins: [
          apiKeyPlugin,
          ...oauthProviderPlugins,
          genericOAuth({
            config: [
              {
                providerId: "google",
                clientId: googleClientId,
                clientSecret: googleClientSecret,
                discoveryUrl: `${appOrigin}/emulate/google/.well-known/openid-configuration`,
                scopes: ["openid", "email", "profile"],
                pkce: true,
                mapProfileToUser: (profile) => ({
                  id: profile.sub,
                  email: profile.email,
                  name: profile.name,
                  image: profile.picture,
                  emailVerified: profile.email_verified ?? true,
                }),
              },
            ],
          }),
        ],
      }
    : {
        socialProviders: {
          google: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
          },
        },
        plugins: [apiKeyPlugin, ...oauthProviderPlugins],
      }),
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
});

export type Session = typeof auth.$Infer.Session;
