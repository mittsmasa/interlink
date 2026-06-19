"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { InterviewNotes } from "@/lib/interview/notes";
import type { InterviewPhase } from "@/lib/interview/phase";
import type { Diagram } from "@/lib/queries/diagrams";
import { ChatPanel } from "./chat-panel";
import { DiagramCanvas } from "./diagram-canvas";
import { NotesPanel } from "./notes-panel";

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
        className="flex min-h-0 w-full flex-1 flex-col border-b md:flex-none md:shrink-0 md:border-b-0 md:[width:var(--left-w)]"
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
      <section className="relative min-h-0 flex-1" aria-label="因果ループ図">
        <DiagramCanvas projectId={project.id} diagram={diagram} />
      </section>
    </div>
  );
}
