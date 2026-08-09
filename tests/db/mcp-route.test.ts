import { describe, expect, it } from "vitest";
import { GET as authServerMetadataRoute } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as protectedResourceRoute } from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import { auth } from "@/lib/auth";
import app from "@/server";
import { createUser } from "./factories";

const MCP_URL = "http://localhost:3000/api/mcp";

const initializeBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.0" },
  },
});

/** MCP の応答は SSE（event: message / data: {...}）で返るので JSON 部分を取り出す */
function parseSseJson(body: string) {
  const line = body.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(line?.slice("data: ".length) ?? "{}");
}

/** MCP エンドポイントへ initialize を投げる */
function postInitialize(headers: Record<string, string>) {
  return app.request(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: initializeBody,
  });
}

describe("MCP エンドポイントの認証", () => {
  it("認証なしなら 401 と WWW-Authenticate ヘッダを返す", async () => {
    const res = await postInitialize({});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"',
    );
  });

  it("不正な Bearer トークンなら 401 になる", async () => {
    const res = await postInitialize({ authorization: "Bearer not-a-jwt" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(
      "oauth-protected-resource",
    );
  });

  it("x-api-key での認証は引き続き通る", async () => {
    const user = await createUser();
    const key = await auth.api.createApiKey({
      body: { name: "test-key", userId: user.id },
    });

    const res = await postInitialize({ "x-api-key": key.key });
    expect(res.status).toBe(200);
    const payload = parseSseJson(await res.text()) as {
      result?: { serverInfo?: { name: string } };
    };
    expect(payload.result?.serverInfo).toBeDefined();
  });
});

describe("OAuth メタデータ", () => {
  it("認可サーバーメタデータが issuer と各エンドポイントを返す", async () => {
    const res = await authServerMetadataRoute(
      new Request(
        "http://localhost:3000/.well-known/oauth-authorization-server",
      ),
    );
    expect(res.status).toBe(200);
    const metadata = (await res.json()) as Record<string, unknown>;
    expect(metadata.issuer).toBe("http://localhost:3000/api/auth");
    expect(metadata.authorization_endpoint).toBe(
      "http://localhost:3000/api/auth/oauth2/authorize",
    );
    expect(metadata.token_endpoint).toBe(
      "http://localhost:3000/api/auth/oauth2/token",
    );
    // DCR を有効にしているので登録エンドポイントが広告される
    expect(metadata.registration_endpoint).toBe(
      "http://localhost:3000/api/auth/oauth2/register",
    );
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("保護リソースメタデータが MCP の resource と認可サーバーを指す", async () => {
    const res = protectedResourceRoute();
    expect(res.status).toBe(200);
    const metadata = (await res.json()) as Record<string, unknown>;
    expect(metadata.resource).toBe("http://localhost:3000/api/mcp");
    expect(metadata.authorization_servers).toEqual([
      "http://localhost:3000/api/auth",
    ]);
    expect(metadata.bearer_methods_supported).toEqual(["header"]);
  });
});

describe("動的クライアント登録（DCR）", () => {
  it("未認証でもクライアントを登録でき、PKCE 必須の public クライアントになる", async () => {
    const res = await app.request(
      "http://localhost:3000/api/auth/oauth2/register",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "probe",
          redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
          token_endpoint_auth_method: "none",
        }),
      },
    );
    expect(res.status).toBe(200);
    const client = (await res.json()) as {
      client_id: string;
      redirect_uris: string[];
    };
    expect(client.client_id).toBeTruthy();
    expect(client.redirect_uris).toEqual([
      "https://claude.ai/api/mcp/auth_callback",
    ]);
  });
});
