"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
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

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <section
        className="flex min-h-0 flex-1 flex-col border-b md:max-w-[40%] md:border-r md:border-b-0"
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
      <section className="relative min-h-0 flex-1" aria-label="因果ループ図">
        <DiagramCanvas projectId={project.id} diagram={diagram} />
      </section>
    </div>
  );
}
