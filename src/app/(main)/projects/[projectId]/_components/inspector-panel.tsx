"use client";

import { XIcon } from "@phosphor-icons/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { NodeKind, Polarity } from "@/db/schema";
import type { Diagram, DiagramEdge, DiagramNode } from "@/lib/queries/diagrams";
import { cn } from "@/lib/utils";
import { deleteEdge, deleteNode, updateEdge, updateNode } from "../_actions";

type InspectorPanelProps = {
  projectId: string;
  selected:
    | { kind: "node"; node: DiagramNode }
    | { kind: "edge"; edge: DiagramEdge };
  diagram: Diagram;
  onClose: () => void;
};

export function InspectorPanel({
  projectId,
  selected,
  diagram,
  onClose,
}: InspectorPanelProps) {
  return (
    <aside className="absolute top-3 right-3 w-72 rounded-lg border bg-card/95 p-4 shadow-md backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-muted-foreground text-xs tracking-wide">
          {selected.kind === "node" ? "変数" : "因果リンク"}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onClose}
          aria-label="閉じる"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      {selected.kind === "node" ? (
        <NodeForm
          projectId={projectId}
          node={selected.node}
          onClose={onClose}
        />
      ) : (
        <EdgeForm
          projectId={projectId}
          edge={selected.edge}
          diagram={diagram}
          onClose={onClose}
        />
      )}
    </aside>
  );
}

const KIND_OPTIONS: { value: NodeKind | null; label: string }[] = [
  { value: null, label: "未分類" },
  { value: "stock", label: "ストック" },
  { value: "flow", label: "フロー" },
  { value: "auxiliary", label: "補助変数" },
  { value: "constant", label: "定数" },
];

function NodeForm({
  projectId,
  node,
  onClose,
}: {
  projectId: string;
  node: DiagramNode;
  onClose: () => void;
}) {
  const [name, setName] = useState(node.name);
  const [kind, setKind] = useState<NodeKind | null>(node.kind);
  const [expression, setExpression] = useState(node.expression ?? "");
  const [initialValue, setInitialValue] = useState(
    node.initialValue?.toString() ?? "",
  );
  const [value, setValue] = useState(node.value?.toString() ?? "");
  const [memo, setMemo] = useState(node.memo ?? "");
  const [unit, setUnit] = useState(node.unit ?? "");
  const [isPending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      const result = await updateNode(projectId, node.id, {
        name,
        memo,
        unit,
        kind,
        expression,
        initialValue: initialValue.trim() === "" ? null : Number(initialValue),
        value: value.trim() === "" ? null : Number(value),
      });
      if (result.ok) {
        toast.success("変数を更新しました");
      } else {
        toast.error(result.error ?? "更新できませんでした");
      }
    });
  };

  const remove = () => {
    if (!window.confirm(`変数「${node.name}」と接続するリンクを削除しますか?`))
      return;
    startTransition(async () => {
      const result = await deleteNode(projectId, node.id);
      if (result.ok) {
        toast.success("変数を削除しました");
        onClose();
      } else {
        toast.error("削除できませんでした");
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="node-name">名前</Label>
        <Input
          id="node-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>役割</Label>
        <div className="flex flex-wrap gap-1.5">
          {KIND_OPTIONS.map((opt) => (
            <KindButton
              key={opt.label}
              label={opt.label}
              active={kind === opt.value}
              onClick={() => setKind(opt.value)}
            />
          ))}
        </div>
      </div>
      {kind === "stock" && (
        <div className="space-y-1.5">
          <Label htmlFor="node-initial">初期値</Label>
          <Input
            id="node-initial"
            type="number"
            value={initialValue}
            onChange={(e) => setInitialValue(e.target.value)}
            placeholder="例: 30"
          />
        </div>
      )}
      {(kind === "flow" || kind === "auxiliary") && (
        <div className="space-y-1.5">
          <Label htmlFor="node-expr">式</Label>
          <Input
            id="node-expr"
            value={expression}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="例: 疲労/100"
          />
          <p className="text-[11px] text-muted-foreground">
            他の変数名と + − * / で書く
          </p>
        </div>
      )}
      {kind === "constant" && (
        <div className="space-y-1.5">
          <Label htmlFor="node-value">定数値</Label>
          <Input
            id="node-value"
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="例: 0.1"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="node-memo">メモ</Label>
        <Textarea
          id="node-memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={2}
          placeholder="この変数の意味・文脈"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="node-unit">単位</Label>
        <Input
          id="node-unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          placeholder="例: 時間/週"
        />
      </div>
      <FormFooter isPending={isPending} onSave={save} onDelete={remove} />
    </div>
  );
}

function KindButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md border px-2 py-1 font-serif text-xs transition-colors",
        active
          ? "border-ink bg-ink/10 text-ink"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

function EdgeForm({
  projectId,
  edge,
  diagram,
  onClose,
}: {
  projectId: string;
  edge: DiagramEdge;
  diagram: Diagram;
  onClose: () => void;
}) {
  const [polarity, setPolarity] = useState<Polarity>(edge.polarity);
  const [hasDelay, setHasDelay] = useState(edge.hasDelay);
  const [rationale, setRationale] = useState(edge.rationale);
  const [isPending, startTransition] = useTransition();

  const nameOf = (id: string) =>
    diagram.nodes.find((n) => n.id === id)?.name ?? "?";

  const save = () => {
    startTransition(async () => {
      const result = await updateEdge(projectId, edge.id, {
        polarity,
        hasDelay,
        rationale,
      });
      if (result.ok) {
        toast.success("リンクを更新しました");
      } else {
        toast.error("更新できませんでした");
      }
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteEdge(projectId, edge.id);
      if (result.ok) {
        toast.success("リンクを削除しました");
        onClose();
      } else {
        toast.error("削除できませんでした");
      }
    });
  };

  return (
    <div className="space-y-3">
      <p className="font-serif text-sm">
        {nameOf(edge.sourceNodeId)} → {nameOf(edge.targetNodeId)}
      </p>
      <div className="space-y-1.5">
        <Label>極性</Label>
        <div className="flex gap-1.5">
          <PolarityButton
            label="+ 同方向"
            active={polarity === "+"}
            onClick={() => setPolarity("+")}
          />
          <PolarityButton
            label="− 逆方向"
            active={polarity === "-"}
            onClick={() => setPolarity("-")}
            negative
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={hasDelay}
          onChange={(e) => setHasDelay(e.target.checked)}
          className="accent-primary"
        />
        遅れがある（∥）
      </label>
      <div className="space-y-1.5">
        <Label htmlFor="edge-rationale">因果の根拠</Label>
        <Textarea
          id="edge-rationale"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          rows={3}
        />
      </div>
      <FormFooter isPending={isPending} onSave={save} onDelete={remove} />
    </div>
  );
}

function PolarityButton({
  label,
  active,
  onClick,
  negative,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  negative?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md border px-2 py-1.5 font-serif text-sm transition-colors",
        active
          ? negative
            ? "border-vermilion bg-vermilion/10 text-vermilion"
            : "border-ink bg-ink/10 text-ink"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

function FormFooter({
  isPending,
  onSave,
  onDelete,
}: {
  isPending: boolean;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between pt-1">
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        disabled={isPending}
        onClick={onDelete}
      >
        削除
      </Button>
      <Button size="sm" disabled={isPending} onClick={onSave}>
        保存
      </Button>
    </div>
  );
}
