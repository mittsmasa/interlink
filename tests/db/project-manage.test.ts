import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deleteProject } from "@/app/(main)/_actions";
import { updateProjectTitle } from "@/app/(main)/projects/[projectId]/_actions";
import { db } from "@/db";
import { nodes, projects } from "@/db/schema";
import { deleteOwnedProject, renameOwnedProject } from "@/lib/projects/manage";
import { createProject, createUser } from "./factories";

async function findProject(id: string) {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

describe("deleteOwnedProject", () => {
  it("所有者なら削除でき、紐づくノードも cascade で消える", async () => {
    const user = await createUser();
    const project = await createProject(user.id);
    await db.insert(nodes).values({ projectId: project.id, name: "残業時間" });

    expect(await deleteOwnedProject(project.id, user.id)).toBe(true);
    expect(await findProject(project.id)).toBeUndefined();
    expect(
      await db.query.nodes.findMany({ where: eq(nodes.projectId, project.id) }),
    ).toHaveLength(0);
  });

  it("他人のプロジェクトは削除されず false", async () => {
    const owner = await createUser();
    const other = await createUser();
    const project = await createProject(owner.id);

    expect(await deleteOwnedProject(project.id, other.id)).toBe(false);
    expect(await findProject(project.id)).toBeDefined();
  });
});

describe("renameOwnedProject", () => {
  it("前後の空白を落として改名する", async () => {
    const user = await createUser();
    const project = await createProject(user.id, { title: "古い題" });
    const result = await renameOwnedProject(project.id, user.id, "  新しい題 ");
    expect(result).toEqual({ ok: true, title: "新しい題" });
    expect((await findProject(project.id))?.title).toBe("新しい題");
  });

  it("空タイトルと他人のプロジェクトは拒否する", async () => {
    const owner = await createUser();
    const other = await createUser();
    const project = await createProject(owner.id, { title: "元の題" });

    expect(await renameOwnedProject(project.id, owner.id, "   ")).toEqual({
      ok: false,
      reason: "empty-title",
    });
    expect(await renameOwnedProject(project.id, other.id, "乗っ取り")).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect((await findProject(project.id))?.title).toBe("元の題");
  });
});

describe("server actions は manage.ts と同じ所有権チェックを通る", () => {
  it("deleteProject / updateProjectTitle はセッションユーザーの所有分だけ触る", async () => {
    const user = await createUser();
    const other = await createUser();
    const mine = await createProject(user.id, { title: "自分の" });
    const theirs = await createProject(other.id, { title: "他人の" });
    (globalThis as { __mockSession?: unknown }).__mockSession = {
      user: { id: user.id },
    };

    expect(await updateProjectTitle(mine.id, "改名後")).toEqual({ ok: true });
    expect(await updateProjectTitle(theirs.id, "改名後")).toEqual({
      ok: false,
    });
    expect(await updateProjectTitle(mine.id, " ")).toEqual({ ok: false });
    expect((await findProject(mine.id))?.title).toBe("改名後");
    expect((await findProject(theirs.id))?.title).toBe("他人の");

    await deleteProject(theirs.id);
    expect(await findProject(theirs.id)).toBeDefined();
    await deleteProject(mine.id);
    expect(await findProject(mine.id)).toBeUndefined();
  });
});
