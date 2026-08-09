"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * 同意の確定。oauthProviderClient が現在 URL の署名付きクエリを
 * oauth_query として自動添付するため、ここでパラメータを渡す必要はない。
 * 応答の url（許可なら code 付き、拒否なら access_denied 付き）へ遷移する
 */
export function ConsentForm() {
  const [isPending, setIsPending] = useState(false);

  const decide = async (accept: boolean) => {
    setIsPending(true);
    try {
      const { data, error } = await authClient.oauth2.consent({ accept });
      if (error || !data?.url) {
        toast.error(
          "処理に失敗しました。接続元のアプリからやり直してください。",
        );
        setIsPending(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      toast.error("処理に失敗しました。接続元のアプリからやり直してください。");
      setIsPending(false);
    }
  };

  return (
    <div className="flex gap-3">
      <Button
        variant="outline"
        size="lg"
        disabled={isPending}
        onClick={() => decide(false)}
      >
        拒否
      </Button>
      <Button size="lg" disabled={isPending} onClick={() => decide(true)}>
        許可する
      </Button>
    </div>
  );
}
