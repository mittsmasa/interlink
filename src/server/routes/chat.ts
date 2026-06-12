import { zValidator } from "@hono/zod-validator";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { model } from "@/lib/ai";
import { auth } from "@/lib/auth";
import { saveMessages } from "@/lib/chat-store";
import { planDiagramMutation } from "@/lib/diagram/apply-diff";
import { diagramDiffSchema } from "@/lib/diagram/diff-schema";
import { applyMutationPlan } from "@/lib/diagram/mutate";
import { loadDiagramSnapshot } from "@/lib/diagram/snapshot";
import { buildInterviewSystemPrompt } from "@/lib/prompts/interview";

const bodySchema = z.object({
  projectId: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
});

export const chatRoute = new Hono().post(
  "/",
  zValidator("json", bodySchema),
  async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) {
      return c.json({ error: "ログインが必要です" }, 401);
    }

    const body = c.req.valid("json");
    const uiMessages = body.messages as UIMessage[];

    const project = await db.query.projects.findFirst({
      where: and(
        eq(projects.id, body.projectId),
        eq(projects.userId, session.user.id),
      ),
    });
    if (!project) {
      return c.json({ error: "プロジェクトが見つかりません" }, 404);
    }
    const projectId = project.id;

    const diagram = await loadDiagramSnapshot(projectId);

    const result = streamText({
      model,
      system: buildInterviewSystemPrompt(diagram),
      messages: await convertToModelMessages(uiMessages),
      // ツール実行後にテキストで続きを話せるよう複数ステップを許可する
      stopWhen: stepCountIs(4),
      tools: {
        updateDiagram: tool({
          description:
            "因果ループ図を差分で更新する。変数・因果リンクの追加/更新/削除を一括で指定できる。既存の図への増分修正として使うこと",
          inputSchema: diagramDiffSchema,
          execute: async (diff) => {
            // 同一ストリーム内の前のツール実行を反映した最新の図に対して適用する
            const current = await loadDiagramSnapshot(projectId);
            const planResult = planDiagramMutation(current, diff);
            if (!planResult.ok) {
              return { ok: false, error: planResult.reason };
            }
            await applyMutationPlan(projectId, planResult.plan);
            const { plan } = planResult;
            return {
              ok: true,
              warnings: plan.warnings,
              applied: {
                createdNodes: plan.createNodes.length,
                updatedNodes: plan.updateNodes.length,
                deletedNodes: plan.deleteNodeIds.length,
                createdEdges: plan.createEdges.length,
                updatedEdges: plan.updateEdges.length,
                deletedEdges: plan.deleteEdgeIds.length,
              },
            };
          },
        }),
      },
    });

    return result.toUIMessageStreamResponse({
      originalMessages: uiMessages,
      onError: (error) => {
        console.error("[chat] stream error", error);
        return "応答の生成に失敗しました。もう一度お試しください。";
      },
      onFinish: async ({ messages: finishedMessages }) => {
        try {
          await saveMessages(projectId, finishedMessages);
        } catch (error) {
          console.error("[chat] saveMessages failed", error);
        }
      },
    });
  },
);
