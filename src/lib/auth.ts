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
/** preview の Google OAuth エミュレータ（src/app/emulate/[...path]/route.ts）の基底 URL */
const emulatorOrigin = `${appOrigin}/emulate/google`;

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
 * resources に MCP エンドポイントを入れることで、resource パラメータ付きの
 * 認可リクエストが JWT アクセストークンを受け取れる（起動時に oauth_resources へ seed される）。
 * enforcePerClientResources を切っているのは、DCR で自己登録するクライアントは
 * リソースとのリンク（oauth_client_resources）を持たず、既定の true だと
 * resource 付き認可が invalid_target になるため。リソースは 1 つしかないので
 * 全クライアント共通で許可する（1.6 の validAudiences と同じ意味）
 */
const oauthProviderPlugins = [
  jwt(),
  oauthProvider({
    loginPage: "/login",
    consentPage: "/oauth/consent",
    resources: [mcpResourceUrl],
    enforcePerClientResources: false,
    allowDynamicClientRegistration: true,
    allowUnauthenticatedClientRegistration: true,
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
                // discoveryUrl は使わず endpoint を明示する。
                // better-auth 1.7 は discovery で jwks_uri が見つかると id_token を
                // その JWKS で必ず検証するが、@emulators/google は id_token を HS256 で
                // 署名し JWKS は空を返すため検証に落ちてログインできない。
                // endpoint 明示なら id_token 検証を組み立てず userinfo だけを使う
                authorizationUrl: `${emulatorOrigin}/o/oauth2/v2/auth`,
                tokenUrl: `${emulatorOrigin}/oauth2/token`,
                userInfoUrl: `${emulatorOrigin}/oauth2/v2/userinfo`,
                scopes: ["openid", "email", "profile"],
                pkce: true,
                // discovery を使わない plain OAuth 扱いでは識別子の既定が `id` になるので、
                // Google 形式の userinfo に合わせて `sub` を明示する。
                // 1.7 から mapProfileToUser で id を返すことはできない
                accountSubject: ({ profile }) => String(profile.sub),
                mapProfileToUser: (profile) => ({
                  email: profile.email,
                  name: profile.name,
                  // 標準クレーム以外は unknown 型で渡ってくる
                  image:
                    typeof profile.picture === "string"
                      ? profile.picture
                      : undefined,
                  emailVerified:
                    typeof profile.email_verified === "boolean"
                      ? profile.email_verified
                      : true,
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
