import { describe, expect, it } from "vitest";
import { db } from "@/db";
import {
  type InterviewNotes,
  MAX_VARIABLE_CANDIDATES,
  parseInterviewNotes,
} from "@/lib/interview/notes";
import { saveInterviewNotes } from "@/lib/interview/store";
import { createProject, createUser } from "./factories";

async function loadNotesRow(projectId: string) {
  const row = await db.query.projects.findFirst({
    where: (p, { eq }) => eq(p.id, projectId),
  });
  return row?.interviewNotes ?? null;
}

describe("saveInterviewNotes", () => {
  it("保存 → parseInterviewNotes の往復が一致し、返却 phase が導出と一致する", async () => {
    const user = await createUser();
    const project = await createProject(user.id);

    const notes: InterviewNotes = {
      theme: "残業が減らない",
      behavior: {
        pattern: "increasing",
        description: "半年前から増え続けている",
      },
      idealBehavior: "横ばいに落ち着いてほしい",
      stakeholders: [{ name: "自分", concerns: ["睡眠を確保したい"] }],
      variableCandidates: [{ name: "残業時間", source: "自分" }],
      confirmedLoopIds: [],
    };

    const result = await saveInterviewNotes(project.id, notes);
    expect(result.ok).toBe(true);
    // テーマと時間挙動が掴めている・図なし → 描く番（ドラフト）
    expect(result.phase).toBe("draft");

    const restored = parseInterviewNotes(await loadNotesRow(project.id));
    expect(restored).toEqual(notes);
  });

  it("上限超過分はキャップして保存される（表示 = 保存の一致）", async () => {
    const user = await createUser();
    const project = await createProject(user.id);

    const notes: InterviewNotes = {
      theme: null,
      behavior: null,
      idealBehavior: null,
      stakeholders: [],
      variableCandidates: Array.from(
        { length: MAX_VARIABLE_CANDIDATES + 4 },
        (_, i) => ({ name: `変数${i}`, source: null }),
      ),
      confirmedLoopIds: [],
    };

    const result = await saveInterviewNotes(project.id, notes);
    // テーマ・挙動が未記録で図もない → 焦点（変数候補はフェーズに影響しない）
    expect(result.phase).toBe("focus");

    const restored = parseInterviewNotes(await loadNotesRow(project.id));
    expect(restored.variableCandidates).toHaveLength(MAX_VARIABLE_CANDIDATES);
    expect(restored.variableCandidates[0]?.name).toBe("変数0");
  });
});
