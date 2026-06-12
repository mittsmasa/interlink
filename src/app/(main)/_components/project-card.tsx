"use client";

import { DotsThreeIcon, GraphIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectStatus } from "@/db/schema";
import { formatDate } from "@/lib/format";
import { deleteProject } from "../_actions";

type ProjectCardProps = {
  project: {
    id: string;
    title: string;
    status: ProjectStatus;
    nodeCount: number;
    updatedAt: number;
  };
};

export function ProjectCard({ project }: ProjectCardProps) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!window.confirm(`「${project.title}」を削除しますか?`)) return;
    startTransition(async () => {
      await deleteProject(project.id);
      toast.success("ノートを削除しました");
    });
  };

  return (
    <div className="group relative rounded-lg border bg-card transition-colors hover:border-ring/40 data-[pending=true]:opacity-50">
      <Link
        href={`/projects/${project.id}`}
        className="block p-5"
        data-pending={isPending}
      >
        <h3 className="font-serif text-lg leading-snug">{project.title}</h3>
        <p className="mt-2 flex items-center gap-3 text-muted-foreground text-xs">
          {project.status === "interviewing" ? (
            <span>聞き取り中…</span>
          ) : (
            <span className="flex items-center gap-1">
              <GraphIcon className="size-3.5" />
              変数 {project.nodeCount}
            </span>
          )}
          <span>{formatDate(project.updatedAt)} 更新</span>
        </p>
      </Link>
      <div className="absolute top-3 right-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-0 transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label="ノートの操作"
            >
              <DotsThreeIcon weight="bold" className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onClick={handleDelete}>
              削除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
