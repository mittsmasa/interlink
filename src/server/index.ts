import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "@/lib/auth";
import { appOrigin } from "@/lib/base-url";
import { chatRoute } from "./routes/chat";
import { mcpRoute } from "./routes/mcp";

const app = new Hono().basePath("/api");

app.use(
  "/auth/*",
  cors({
    origin: appOrigin,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

const routes = app.route("/chat", chatRoute).route("/mcp", mcpRoute);

export type AppType = typeof routes;
export default app;
