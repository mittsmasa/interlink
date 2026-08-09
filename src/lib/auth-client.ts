import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { genericOAuthClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const baseURL =
  typeof window !== "undefined"
    ? window.location.origin
    : (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");

export const authClient = createAuthClient({
  baseURL,
  // oauthProviderClient は現在ページの query（authorize が付けた署名付きパラメータ）を
  // 非 GET リクエストの body に oauth_query として自動添付する。
  // これによりログイン・同意の後に認可フローが自動で再開される
  plugins: [genericOAuthClient(), apiKeyClient(), oauthProviderClient()],
});
