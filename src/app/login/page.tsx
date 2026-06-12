import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { LoginButton } from "./_components/login-button";

export default async function LoginPage() {
  const session = await getSession();
  if (session) {
    redirect("/");
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-display text-5xl tracking-tight">interlink</h1>
        <p className="text-muted-foreground">問いの構造を、図にする。</p>
      </div>
      <LoginButton />
    </main>
  );
}
