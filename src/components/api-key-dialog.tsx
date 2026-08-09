"use client";

import { CheckIcon, CopyIcon, TrashIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { authClient } from "@/lib/auth-client";
import { formatDate } from "@/lib/format";

type ApiKeyRow = {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: Date;
  lastRequest: Date | null;
};

type ApiKeyDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * MCP クライアント用 API キーの発行・一覧・失効。
 * キーの平文は発行レスポンスにのみ含まれるため、発行直後の 1 回だけ表示する
 */
export function ApiKeyDialog({ open, onOpenChange }: ApiKeyDialogProps) {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const loadKeys = useCallback(async () => {
    const { data, error } = await authClient.apiKey.list();
    if (error) {
      toast.error("API キーの取得に失敗しました");
      return;
    }
    setKeys(data?.apiKeys ?? []);
  }, []);

  useEffect(() => {
    if (open) {
      loadKeys();
    } else {
      // 閉じたら平文キーを画面から消す（再表示不可の明示）
      setCreatedKey(null);
      setCopied(false);
    }
  }, [open, loadKeys]);

  const createKey = async () => {
    setBusy(true);
    try {
      const { data, error } = await authClient.apiKey.create({
        name: "MCP クライアント",
      });
      if (error || !data) {
        toast.error("API キーの発行に失敗しました");
        return;
      }
      setCreatedKey(data.key);
      setCopied(false);
      await loadKeys();
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    setBusy(true);
    try {
      const { error } = await authClient.apiKey.delete({ keyId });
      if (error) {
        toast.error("API キーの失効に失敗しました");
        return;
      }
      toast.success("API キーを失効しました");
      await loadKeys();
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    toast.success("コピーしました");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>API キー</DialogTitle>
          <DialogDescription>
            外部エージェント（MCP クライアント）からの接続に使います。キーは
            x-api-key ヘッダで送ります
          </DialogDescription>
        </DialogHeader>

        <Button
          onClick={createKey}
          disabled={busy}
          className="justify-self-start"
        >
          新しいキーを発行
        </Button>

        {createdKey && (
          <div className="min-w-0 rounded-md border bg-muted/50 p-3">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-sm">
                {createdKey}
              </code>
              <Button
                variant="outline"
                size="icon"
                onClick={copyKey}
                aria-label="キーをコピー"
              >
                {copied ? (
                  <CheckIcon className="size-4" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
              </Button>
            </div>
            <p className="mt-2 text-muted-foreground text-xs">
              このキーは二度と表示されません。今すぐコピーしてください
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className="font-medium text-sm">発行済みキー</p>
          {keys.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              キーはまだありません
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                >
                  <code className="text-muted-foreground">{key.start}…</code>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                    作成 {formatDate(new Date(key.createdAt).getTime())}
                    {key.lastRequest
                      ? ` / 最終使用 ${formatDate(new Date(key.lastRequest).getTime())}`
                      : " / 未使用"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => revokeKey(key.id)}
                    disabled={busy}
                    aria-label="キーを失効"
                  >
                    <TrashIcon className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
