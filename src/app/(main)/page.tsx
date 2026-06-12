import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { getProjectsByUserId } from "@/lib/queries/projects";
import { requireSession } from "@/lib/session";
import { createProject } from "./_actions";
import { ProjectCard } from "./_components/project-card";

export default async function HomePage() {
  const session = await requireSession();
  const projects = await getProjectsByUserId(session.user.id);

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader user={session.user} />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12 sm:px-6">
        <section className="mb-12">
          <h1 className="font-display text-3xl leading-relaxed sm:text-4xl">
            あなたの問いの構造を、
            <br className="sm:hidden" />
            図にする。
          </h1>
          <p className="mt-3 max-w-prose text-muted-foreground text-sm leading-relaxed">
            行き詰まった悩みには、たいてい構造があります。対話しながら因果のループを描き、
            眺め、確かめる。そのための机がここにあります。
          </p>
          <form action={createProject} className="mt-6">
            <Button type="submit" size="lg">
              <PlusIcon weight="bold" />
              新しい対話を始める
            </Button>
          </form>
        </section>

        {projects.length > 0 ? (
          <section>
            <h2 className="mb-4 border-b pb-2 font-serif text-muted-foreground text-sm tracking-wide">
              ノート
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {projects.map((project) => (
                <ProjectCard key={project.id} project={project} />
              ))}
            </div>
          </section>
        ) : (
          <section className="rounded-lg border border-dashed px-6 py-12 text-center">
            <p className="text-muted-foreground text-sm">
              まだノートがありません。最初の対話を始めましょう。
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
