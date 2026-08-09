"use client";

import { CheckIcon, CopyIcon, TrashIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
 * キーの平文は発行レスポンスにのみ含まれるため発行直後の 1 回だけ表示する。
 * その間はダイアログ全体を受け渡し表示に切り替え、一覧・失効操作を出さない
 * （コピーという一回きりの操作から注意を逸らさないため）
 */
export function ApiKeyDialog({ open, onOpenChange }: ApiKeyDialogProps) {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  /** インライン失効確認の対象。ゴミ箱 → この行だけ確認表示に変わる */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
      setConfirmingId(null);
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
      setConfirmingId(null);
      await loadKeys();
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {createdKey ? (
        // 受け渡しモード: 発行直後の平文キーだけに集中させる
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新しい API キー</DialogTitle>
            <DialogDescription>
              このキーは今だけ表示されます。コピーして MCP
              クライアントの設定に保存してください
            </DialogDescription>
          </DialogHeader>

          <div className="min-w-0 rounded-md border bg-muted/50 p-3">
            <code className="block break-all text-sm">{createdKey}</code>
          </div>

          <DialogFooter>
            <Button
              variant={copied ? "outline" : "default"}
              onClick={copyKey}
              className="gap-2"
            >
              {copied ? (
                <>
                  <CheckIcon className="size-4" />
                  コピーしました
                </>
              ) : (
                <>
                  <CopyIcon className="size-4" />
                  キーをコピー
                </>
              )}
            </Button>
            <Button
              variant={copied ? "default" : "outline"}
              onClick={() => {
                setCreatedKey(null);
                setCopied(false);
              }}
            >
              完了
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : (
        // 一覧モード: 発行と管理
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

          <div className="flex min-w-0 flex-col gap-2">
            <p className="font-medium text-sm">発行済みキー</p>
            {keys.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                キーはまだありません
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {keys.map((key) =>
                  confirmingId === key.id ? (
                    <li
                      key={key.id}
                      className="flex items-center gap-3 rounded-md border border-destructive/50 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <code className="text-muted-foreground">
                          {key.start}…
                        </code>{" "}
                        を失効しますか？使用中の接続は動かなくなります
                      </span>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => revokeKey(key.id)}
                        disabled={busy}
                      >
                        失効する
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirmingId(null)}
                        disabled={busy}
                      >
                        キャンセル
                      </Button>
                    </li>
                  ) : (
                    <li
                      key={key.id}
                      className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                    >
                      <code className="text-muted-foreground">
                        {key.start}…
                      </code>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
                        作成 {formatDate(new Date(key.createdAt).getTime())}
                        {key.lastRequest
                          ? ` / 最終使用 ${formatDate(new Date(key.lastRequest).getTime())}`
                          : " / 未使用"}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setConfirmingId(key.id)}
                        disabled={busy}
                        aria-label="キーを失効"
                      >
                        <TrashIcon className="size-4" />
                      </Button>
                    </li>
                  ),
                )}
              </ul>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
