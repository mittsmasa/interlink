"use client";

import { GoogleLogoIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function LoginButton() {
  const [isPending, setIsPending] = useState(false);

  const signIn = async () => {
    setIsPending(true);
    try {
      // preview（OAuth エミュレータ）では genericOAuth の providerId "google" が
      // social provider として登録されるので、本番と同じ呼び出しで済む。
      // better-auth クライアントはエラー時に throw せず { error } を返す
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/",
      });
      if (error) {
        toast.error("ログインに失敗しました。もう一度お試しください。");
        setIsPending(false);
      }
    } catch {
      // ネットワーク断などで fetch 自体が失敗した場合
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
