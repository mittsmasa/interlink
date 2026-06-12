import "server-only";
import { gateway } from "ai";

// Vercel AI Gateway 経由でモデルを解決する。
// ローカルは AI_GATEWAY_API_KEY、Vercel 上は OIDC で自動認証。
// AI_GATEWAY_MODEL（<provider>/<model> 形式）で差し替え可能。
// 既定は無料枠で updateDiagram ツール実行まで動く gemini-2.5-flash
// （claude-sonnet-4-6 は有料クレジット必須、flash-lite はツールを呼ばない）。
export const model = gateway(
  process.env.AI_GATEWAY_MODEL ?? "google/gemini-2.5-flash",
);
