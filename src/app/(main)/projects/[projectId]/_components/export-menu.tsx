"use client";

import { ExportIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ExportMenuProps = {
  title: string;
  /** サーバーで描画済みの書き出しテキスト */
  exports: { mermaid: string; markdown: string };
};

/** ファイル名に使えない文字を落とす */
function toFileName(title: string) {
  const safe = title.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
  return `${safe || "diagram"}.md`;
}

/**
 * クリップボードへ書く。Clipboard API が権限で拒否される環境
 * （埋め込みブラウザなど）では、選択 + execCommand の旧来経路にフォールバックする
 */
async function writeClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }
}

/** 図を mermaid / markdown で持ち出すヘッダーメニュー */
export function ExportMenu({ title, exports }: ExportMenuProps) {
  const copy = async (text: string, label: string) => {
    if (await writeClipboard(text)) {
      toast.success(`${label}をコピーしました`);
    } else {
      toast.error("コピーできませんでした");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(
      new Blob([exports.markdown], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = toFileName(title);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="図を書き出す"
          title="図を書き出す"
        >
          <ExportIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => copy(exports.mermaid, "Mermaid")}>
          Mermaid をコピー
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => copy(exports.markdown, "Markdown")}>
          Markdown をコピー
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={download}>
          Markdown をダウンロード
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
