"use client";

import { KeyIcon, SignOutIcon, UserCircleIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";

type UserMenuProps = {
  user: { name: string; image?: string | null };
};

export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter();
  const [apiKeyDialogOpen, setApiKeyDialogOpen] = useState(false);

  const signOut = async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      <ApiKeyDialog
        open={apiKeyDialogOpen}
        onOpenChange={setApiKeyDialogOpen}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="アカウント">
            {user.image ? (
              // biome-ignore lint/performance/noImgElement: 外部アバターの最適化は不要
              <img
                src={user.image}
                alt=""
                className="size-6 rounded-full"
                referrerPolicy="no-referrer"
              />
            ) : (
              <UserCircleIcon className="size-5" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setApiKeyDialogOpen(true)}>
            <KeyIcon className="size-4" />
            API キー
          </DropdownMenuItem>
          <DropdownMenuItem onClick={signOut}>
            <SignOutIcon className="size-4" />
            ログアウト
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
