"use client";

import {
  ArrowUpIcon,
  CircleNotchIcon,
  GraphIcon,
  StopIcon,
} from "@phosphor-icons/react";
import type { ChatStatus, UIMessage } from "ai";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ChatPanelProps = {
  messages: UIMessage[];
  sendMessage: (text: string) => void;
  status: ChatStatus;
  stop: () => void;
};

export function ChatPanel({
  messages,
  sendMessage,
  status,
  stop,
}: ChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);

  const isLoading = status === "submitted" || status === "streaming";

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    isAtBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: メッセージ追加のたびに追従させる
  useEffect(() => {
    const el = scrollRef.current;
    if (el && isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    sendMessage(text);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-5 overflow-y-auto px-4 py-5"
      >
        {messages.length === 0 ? (
          <div className="mt-10 space-y-2 text-center text-muted-foreground text-sm leading-relaxed">
            <p>いま、どんなことが気がかりですか。</p>
            <p className="text-xs">
              うまくまとまっていなくて大丈夫です。話しながら整理していきます。
            </p>
          </div>
        ) : (
          messages.map((message) => (
            <Message key={message.id} message={message} />
          ))
        )}
        {status === "submitted" && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <CircleNotchIcon className="size-3.5 animate-spin" />
            考えています…
          </div>
        )}
      </div>

      <form onSubmit={submit} className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit(e);
              }
            }}
            placeholder="メッセージを入力（Shift+Enter で改行）"
            rows={2}
            className="min-h-0 resize-none"
          />
          {isLoading ? (
            <Button
              type="button"
              size="icon"
              variant="outline"
              onClick={stop}
              aria-label="停止"
            >
              <StopIcon weight="fill" className="size-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim()}
              aria-label="送信"
            >
              <ArrowUpIcon weight="bold" className="size-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function Message({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3.5 py-2.5 text-primary-foreground text-sm leading-relaxed">
          {message.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: parts は順序固定
              key={i}
              className="whitespace-pre-wrap text-sm leading-relaxed"
            >
              {part.text}
            </div>
          );
        }
        if (part.type === "tool-updateDiagram") {
          const done = part.state === "output-available";
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: parts は順序固定
              key={i}
              className={cn(
                "flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-muted-foreground text-xs",
                !done && "animate-pulse",
              )}
            >
              <GraphIcon className="size-3.5" />
              {done ? "図を更新しました" : "図を描いています…"}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
