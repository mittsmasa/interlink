import { hc } from "hono/client";
import type { AppType } from "@/server";

export const rpc = hc<AppType>("/");
