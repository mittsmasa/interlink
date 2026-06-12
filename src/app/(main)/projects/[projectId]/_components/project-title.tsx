"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { ProjectStatus } from "@/db/schema";
import { cn } from "@/lib/utils";
import { updateProjectTitle } from "../_actions";

type ProjectTitleProps = {
  project: { id: string; title: string; status: ProjectStatus };
};

export function ProjectTitle({ project }: ProjectTitleProps) {
  const [editing, setEditing] = useState(false);
  const [, startTransition] = useTransition();

  const commit = (value: string) => {
    setEditing(false);
    const title = value.trim();
    if (!title || title === project.title) return;
    startTransition(async () => {
      const result = await updateProjectTitle(project.id, title);
      if (!result.ok) toast.error("タイトルを変更できませんでした");
    });
  };

  return (
    <div className="flex min-w-0 items-baseline gap-3">
      {editing ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: 編集開始の直接操作に続くフォーカス
          autoFocus
          defaultValue={project.title}
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(e.currentTarget.value);
            if (e.key === "Escape") setEditing(false);
          }}
          className="min-w-0 border-b bg-transparent font-serif text-sm focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="truncate font-serif text-sm hover:text-muted-foreground"
          title="クリックして名前を変更"
        >
          {project.title}
        </button>
      )}
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground",
          project.status === "interviewing" && "border-dashed",
        )}
      >
        {project.status === "interviewing" ? "聞き取り中" : "図あり"}
      </span>
    </div>
  );
}
