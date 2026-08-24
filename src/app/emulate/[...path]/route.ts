import type { NextRequest } from "next/server";
import { appOrigin } from "@/lib/base-url";

type RouteContext = { params: Promise<{ path: string[] }> };
type MethodHandler = (req: NextRequest, ctx: RouteContext) => Promise<Response>;
type EmulateHandlers = {
  GET: MethodHandler;
  POST: MethodHandler;
  PUT: MethodHandler;
  PATCH: MethodHandler;
  DELETE: MethodHandler;
};

const NOT_FOUND: MethodHandler = async () =>
  new Response(null, { status: 404 });
const NOT_FOUND_HANDLERS: EmulateHandlers = {
  GET: NOT_FOUND,
  POST: NOT_FOUND,
  PUT: NOT_FOUND,
  PATCH: NOT_FOUND,
  DELETE: NOT_FOUND,
};

const handlersPromise: Promise<EmulateHandlers> =
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview"
    ? (async () => {
        const [{ createEmulateHandler }, googleModule] = await Promise.all([
          import("@emulators/adapter-next"),
          import("@emulators/google"),
        ]);

        const branchUrl = process.env.VERCEL_BRANCH_URL
          ? `https://${process.env.VERCEL_BRANCH_URL}`
          : undefined;
        const deploymentUrl = process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : undefined;

        // ローカル側のオリジンは appOrigin から導出する。portless 配下では
        // worktree ごとに割り当て URL が変わるため、固定リストは維持できない
        const redirectUris = Array.from(
          new Set(
            [appOrigin, branchUrl, deploymentUrl]
              .filter((v): v is string => Boolean(v))
              .map((origin) => `${origin}/api/auth/oauth2/callback/google`),
          ),
        );

        return createEmulateHandler({
          services: {
            google: {
              emulator: googleModule,
              seed: {
                oauth_clients: [
                  {
                    client_id: process.env.GOOGLE_CLIENT_ID ?? "emulate-client",
                    client_secret:
                      process.env.GOOGLE_CLIENT_SECRET ?? "emulate-secret",
                    name: "Interlink Preview",
                    redirect_uris: redirectUris,
                  },
                ],
                users: [
                  {
                    email: "preview-tester@example.com",
                    name: "Preview Tester",
                    given_name: "Preview",
                    family_name: "Tester",
                    email_verified: true,
                  },
                ],
              },
            },
          },
        }) as EmulateHandlers;
      })()
    : Promise.resolve(NOT_FOUND_HANDLERS);

/**
 * adapter に渡す前に Request の URL を公開オリジンへ揃える。
 *
 * `@emulators/adapter-next` は `new URL(req.url).origin` からのみ discovery の
 * issuer / 各エンドポイントを組み立てる（origin を明示する設定は無い）。
 * portless のような reverse proxy の後ろでは Next が見る host が転送先の
 * `localhost:<random>` になるため、そのままでは内部アドレスをブラウザへ広告してしまう。
 *
 * origin が一致する場合（素の `next dev`）は元の Request をそのまま返すので回帰は無い。
 */
function withPublicOrigin(req: NextRequest): NextRequest {
  const url = new URL(req.url);
  if (url.origin === appOrigin) return req;

  const publicUrl = new URL(`${url.pathname}${url.search}`, appOrigin);
  return new Request(publicUrl, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    duplex: "half",
  } as RequestInit) as NextRequest;
}

async function dispatch(
  method: keyof EmulateHandlers,
  req: NextRequest,
  ctx: RouteContext,
) {
  const handlers = await handlersPromise;
  return handlers[method](withPublicOrigin(req), ctx);
}

export const GET = (req: NextRequest, ctx: RouteContext) =>
  dispatch("GET", req, ctx);
export const POST = (req: NextRequest, ctx: RouteContext) =>
  dispatch("POST", req, ctx);
export const PUT = (req: NextRequest, ctx: RouteContext) =>
  dispatch("PUT", req, ctx);
export const PATCH = (req: NextRequest, ctx: RouteContext) =>
  dispatch("PATCH", req, ctx);
export const DELETE = (req: NextRequest, ctx: RouteContext) =>
  dispatch("DELETE", req, ctx);
