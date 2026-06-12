import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";

type AppHeaderProps = {
  user: { name: string; image?: string | null };
  /** ワークスペースなどでアプリ名の隣に出す副題 */
  subtitle?: React.ReactNode;
};

export function AppHeader({ user, subtitle }: AppHeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b px-4 sm:px-6">
      <div className="flex min-w-0 items-baseline gap-4">
        <Link href="/" className="font-display text-xl tracking-tight">
          interlink
        </Link>
        {subtitle}
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
