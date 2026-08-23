"use client";

import { useChat } from "@ai-sdk/react";
import { SidebarSimpleIcon } from "@phosphor-icons/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { InterviewNotes } from "@/lib/interview/notes";
import type { InterviewPhase } from "@/lib/interview/phase";
import type { Diagram } from "@/lib/queries/diagrams";
import { cn } from "@/lib/utils";
import { ChatPanel } from "./chat-panel";
import { DiagramCanvas } from "./diagram-canvas";
import { NotesPanel } from "./notes-panel";

// 対話エリアの開閉はプロジェクト横断の表示設定として保持する
const CHAT_OPEN_STORAGE_KEY = "interlink:workspace:chat-open";

type WorkspaceProps = {
  project: { id: string };
  initialMessages: UIMessage[];
  diagram: Diagram;
  notes: InterviewNotes;
  phase: InterviewPhase;
};

export function Workspace({
  project,
  initialMessages,
  diagram,
  notes,
  phase,
}: WorkspaceProps) {
  const router = useRouter();

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { projectId: project.id, messages },
        }),
      }),
    [project.id],
  );

  const { messages, sendMessage, status, stop } = useChat({
    id: project.id,
    messages: initialMessages,
    transport,
    // ツールで図が変わった可能性があるため RSC を再読込して
    // 最新の diagram props をキャンバスへ流す
    onFinish: () => router.refresh(),
    onError: () => {
      toast.error("応答の取得に失敗しました。もう一度お試しください。");
    },
  });

  // 対話エリアの幅（%）。md+ の横並びレイアウト時のみ反映。ドラッグで 25〜60% に可変
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [leftPct, setLeftPct] = useState(40);

  // MCP 経由で図を操作するときなど、対話を使わない場面ではキャンバスを全幅にする。
  // ChatPanel は unmount せず display:none で畳み、入力中テキストとスクロール位置を保つ
  const [chatOpen, setChatOpen] = useState(true);

  // localStorage は SSR では読めないため、開いた状態で描画してから hydration 後に復元する
  useEffect(() => {
    if (localStorage.getItem(CHAT_OPEN_STORAGE_KEY) === "false") {
      setChatOpen(false);
    }
  }, []);

  const toggleChat = () => {
    const next = !chatOpen;
    setChatOpen(next);
    localStorage.setItem(CHAT_OPEN_STORAGE_KEY, String(next));
  };

  const onHandleMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftPct(Math.max(25, Math.min(60, pct)));
  };

  return (
    <div
      ref={containerRef}
      className="flex min-h-0 flex-1 flex-col md:flex-row"
    >
      <section
        id="workspace-chat"
        className={cn(
          "flex min-h-0 w-full flex-1 flex-col border-b md:flex-none md:shrink-0 md:border-b-0 md:[width:var(--left-w)]",
          !chatOpen && "hidden",
        )}
        style={{ ["--left-w" as string]: `${leftPct}%` } as React.CSSProperties}
        aria-label="対話"
      >
        <NotesPanel notes={notes} phase={phase} />
        <ChatPanel
          messages={messages}
          sendMessage={(text) => sendMessage({ text })}
          status={status}
          stop={stop}
        />
      </section>
      {/* 幅可変ハンドル（md+ のみ）。pointer capture で確実にドラッグを拾う。
          button にしてキーボード（左右キー）でも調整可能にする */}
      {chatOpen && (
        <button
          type="button"
          aria-label="対話エリアの幅を調整"
          className="hidden w-1.5 shrink-0 cursor-col-resize touch-none select-none bg-border transition-colors hover:bg-ring md:block"
          onPointerDown={(e) => {
            draggingRef.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={onHandleMove}
          onPointerUp={(e) => {
            draggingRef.current = false;
            e.currentTarget.releasePointerCapture(e.pointerId);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setLeftPct((p) => Math.max(25, p - 2));
            if (e.key === "ArrowRight") setLeftPct((p) => Math.min(60, p + 2));
          }}
        />
      )}
      <section className="relative min-h-0 flex-1" aria-label="因果ループ図">
        <DiagramCanvas
          projectId={project.id}
          diagram={diagram}
          confirmedLoopIds={notes.confirmedLoopIds}
        />
        {/* 対話の開閉つまみ。キャンバス左端の垂直中央は、構造 / シミュレーション /
            ツールバー / Controls のどれとも重ならない唯一の位置。縦横どちらの分割でも
            同じ場所に付くため、向きを含意しない SidebarSimple を使う */}
        <button
          type="button"
          onClick={toggleChat}
          aria-expanded={chatOpen}
          aria-controls="workspace-chat"
          aria-label={chatOpen ? "対話エリアを畳む" : "対話エリアを開く"}
          title={chatOpen ? "対話エリアを畳む" : "対話エリアを開く"}
          className="-translate-y-1/2 absolute top-1/2 left-0 z-10 flex h-12 w-5 items-center justify-center rounded-r-md border border-l-0 bg-card/95 text-muted-foreground shadow-md backdrop-blur-sm transition-colors hover:bg-accent hover:text-foreground"
        >
          <SidebarSimpleIcon className="size-3.5" />
        </button>
      </section>
    </div>
  );
}
