import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/react";

const baseURL =
  typeof window !== "undefined"
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

export const authClient = createAuthClient({
  baseURL,
  // oauthProviderClient は現在ページの query（authorize が付けた署名付きパラメータ）を
  // 非 GET リクエストの body に oauth_query として自動添付する。
  // これによりログイン・同意の後に認可フローが自動で再開される。
  // preview の Google エミュレータ（genericOAuth）も 1.7 からは social provider として
  // 登録されるため、専用のクライアントプラグインは不要
  plugins: [apiKeyClient(), oauthProviderClient()],
});
