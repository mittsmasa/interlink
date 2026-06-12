"use client";

import { GoogleLogoIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { isPreview } from "@/lib/env";

export function LoginButton() {
  const [isPending, setIsPending] = useState(false);

  const signIn = async () => {
    setIsPending(true);
    try {
      // preview（OAuth エミュレータ）は genericOAuth プラグイン経由になる
      if (isPreview) {
        await authClient.signIn.oauth2({
          providerId: "google",
          callbackURL: "/",
        });
      } else {
        await authClient.signIn.social({
          provider: "google",
          callbackURL: "/",
        });
      }
    } catch {
      toast.error("ログインに失敗しました。もう一度お試しください。");
      setIsPending(false);
    }
  };

  return (
    <Button onClick={signIn} disabled={isPending} size="lg">
      <GoogleLogoIcon weight="bold" />
      Google でログイン
    </Button>
  );
}
