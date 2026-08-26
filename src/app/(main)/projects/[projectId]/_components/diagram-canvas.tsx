"use client";

import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { PlusIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { matchArchetypes } from "@/lib/diagram/archetypes";
import { type LintFinding, lintDiagram } from "@/lib/diagram/lint";
import {
  deriveLoopDependencies,
  toDerivedLoopEdges,
} from "@/lib/diagram/loop-edges";
import { detectLoops, type Loop } from "@/lib/diagram/loops";
import {
  computeDiagramMetrics,
  type InterventionCandidate,
} from "@/lib/diagram/metrics";
import type { SimConfigRecord } from "@/lib/diagram/sim-config";
import { suggestKinds } from "@/lib/diagram/suggest-kinds";
import type { Diagram, DiagramEdge, DiagramNode } from "@/lib/queries/diagrams";
import {
  createEdge,
  createNode,
  updateNodePosition,
  updateNodePositions,
} from "../_actions";
import { CausalEdge, CausalEdgeMarkers } from "./causal-edge";
import { DependencyEdge, DependencyEdgeMarkers } from "./dependency-edge";
import { chooseEdgeRouting } from "./floating-edge-utils";
import { type Highlight, HighlightContext } from "./highlight-context";
import { InspectorPanel } from "./inspector-panel";
import { computePositions, selectRingNodeIds } from "./layout-diagram";
import { LoopBadges } from "./loop-badges";
import { SimulationPanel } from "./simulation-panel";
import { VariableNode } from "./variable-node";
import { VerificationPanel } from "./verification-panel";

const nodeTypes = { variable: VariableNode };
const edgeTypes = { causal: CausalEdge, dependency: DependencyEdge };

type DiagramCanvasProps = {
  projectId: string;
  diagram: Diagram;
  /** ユーザーが実感で確かめたループ ID（lint の speculative-link 判定に使う） */
  confirmedLoopIds: string[];
  /** 保存済みのシミュレーション設定（パネルの初期値） */
  simConfig: SimConfigRecord;
};

export function DiagramCanvas(props: DiagramCanvasProps) {
  return (
    <ReactFlowProvider>
      <DiagramCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function DiagramCanvasInner({
  projectId,
  diagram,
  confirmedLoopIds,
  simConfig,
}: DiagramCanvasProps) {
  const { fitView, screenToFlowPosition } = useReactFlow();
  const { resolvedTheme } = useTheme();
  // resolvedTheme は SSR では不明（常に light 扱い）のため、そのまま使うと
  // ダーク環境で hydration mismatch になる。マウント後にだけ反映する
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  const [selected, setSelected] = useState<
    | { kind: "node"; node: DiagramNode }
    | { kind: "edge"; edge: DiagramEdge }
    | null
  >(null);

  const [openPanel, setOpenPanel] = useState<
    "verification" | "simulation" | null
  >(null);

  // フローティングパネルは外側クリック（バックドロップ）と Esc で閉じる。
  // React Flow の onPaneClick は target が .react-flow__pane そのもののときしか
  // 発火せず、ノード / エッジ / ツールバー / チャット側の上では閉じられない
  useEffect(() => {
    if (!openPanel) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-floating-panel]")) return;
      setOpenPanel(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPanel(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openPanel]);

  // 式の依存（情報リンク）のうち、同方向の因果エッジが無いもの。破線描画とループ参加の
  // 両方でこの同一集合を使い「破線 ⟺ ループ参加リンク」を一致させる（保存せず毎回導出）。
  // 導出は loop-edges.ts に集約し、chat / MCP と同じ集合を見る
  const signedDeps = useMemo(() => deriveLoopDependencies(diagram), [diagram]);

  // 情報リンクを「レイアウト・ループ検出」用の派生エッジ形に正規化する。
  // 同じ集合を computePositions（レイアウト）とループ検出の両方に渡す
  const derivedLoopEdges = useMemo(
    () => toDerivedLoopEdges(signedDeps),
    [signedDeps],
  );

  // ループ・lint・原型・構造指標は図から毎回導出する（保存しない）。ループ検出には因果エッジに
  // 加えて式由来リンクも derived エッジとして渡し、式で閉じる円環を暫定ループとして拾う
  const verification = useMemo(() => {
    const loopEdges = [...diagram.edges, ...derivedLoopEdges];
    const loopResult = detectLoops(diagram.nodes, loopEdges);
    return {
      loopResult,
      findings: lintDiagram(diagram.nodes, diagram.edges, {
        loops: loopResult.loops,
        confirmedLoopIds,
      }),
      matches: matchArchetypes(loopResult.loops),
      metrics: computeDiagramMetrics(
        diagram.nodes,
        loopEdges,
        loopResult.loops,
      ),
      // 未分類ノードの昇格候補。提案であって確定ではないので、inspector で
      // ユーザーが選んで初めて kind が付く
      kindSuggestions: new Map(
        suggestKinds(diagram.nodes, loopEdges, loopResult.loops).map((s) => [
          s.nodeId,
          s,
        ]),
      ),
    };
  }, [diagram, derivedLoopEdges, confirmedLoopIds]);

  const [highlight, setHighlight] = useState<Highlight>(null);
  const highlightLoop = useCallback((loop: Loop | null) => {
    setHighlight(
      loop
        ? { nodeIds: new Set(loop.nodeIds), edgeIds: new Set(loop.edgeIds) }
        : null,
    );
  }, []);

  // 介入候補のホバーでは、その変数と交差している全ループを一緒に光らせる
  const highlightCandidate = useCallback(
    (candidate: InterventionCandidate | null) => {
      if (!candidate) {
        setHighlight(null);
        return;
      }
      const ids = new Set(candidate.loopIds);
      const nodeIds = new Set([candidate.nodeId]);
      const edgeIds = new Set<string>();
      for (const loop of verification.loopResult.loops) {
        if (!ids.has(loop.id)) continue;
        for (const id of loop.nodeIds) nodeIds.add(id);
        for (const id of loop.edgeIds) edgeIds.add(id);
      }
      setHighlight({ nodeIds, edgeIds });
    },
    [verification.loopResult.loops],
  );

  const selectFinding = useCallback(
    (finding: LintFinding) => {
      const node = diagram.nodes.find((n) => finding.nodeIds?.includes(n.id));
      if (node) {
        setSelected({ kind: "node", node });
        return;
      }
      const edge = diagram.edges.find((e) => finding.edgeIds?.includes(e.id));
      if (edge) setSelected({ kind: "edge", edge });
    },
    [diagram],
  );

  const { rfNodes, rfEdges } = useMemo(() => {
    const positions = computePositions(diagram, {
      derivedEdges: derivedLoopEdges,
    });
    // computePositions と同一エッジ集合由来の loops から ring を導出（基準を揃える）。
    // 両端とも ring 上のエッジは円環が外へ膨らむ側を優遇する
    const ringNodeIds = new Set(
      selectRingNodeIds(verification.loopResult.loops),
    );
    // 因果エッジと情報リンクをまとめて 1 回で解く。別々に解くと互いを避けられない
    const { curvatures, selfLoopAngles } = chooseEdgeRouting(
      [
        ...diagram.edges.map((edge) => ({
          id: edge.id,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
        })),
        ...signedDeps.map((dep) => ({
          id: dep.id,
          sourceNodeId: dep.fromNodeId,
          targetNodeId: dep.toNodeId,
        })),
      ],
      positions,
      { ringNodeIds },
    );
    const causalEdges = diagram.edges.map(
      (edge): Edge => ({
        id: edge.id,
        type: "causal",
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        data: {
          edge,
          curvature: curvatures.get(edge.id),
          selfLoopAngle: selfLoopAngles.get(edge.id),
        },
      }),
    );
    // 式の依存を情報リンク（破線）として描く。signedDeps は既に同方向の因果エッジが無いものに
    // 絞り込み済み（実線優先で破線は重ねない）。描画自体は極性を使わない
    const dependencyEdges = signedDeps.map(
      (dep): Edge => ({
        id: dep.id,
        type: "dependency",
        source: dep.fromNodeId,
        target: dep.toNodeId,
        selectable: false,
        focusable: false,
        data: {
          curvature: curvatures.get(dep.id),
          selfLoopAngle: selfLoopAngles.get(dep.id),
        },
      }),
    );
    return {
      rfNodes: diagram.nodes.map(
        (node): Node => ({
          id: node.id,
          type: "variable",
          position: positions.get(node.id) ?? { x: 0, y: 0 },
          data: { node },
        }),
      ),
      rfEdges: [...causalEdges, ...dependencyEdges],
    };
  }, [diagram, signedDeps, derivedLoopEdges, verification.loopResult.loops]);

  const [nodes, setNodes, onNodesChange] = useNodesState(rfNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(rfEdges);

  // チャット経由で図が変わったとき（router.refresh 後）に同期する
  useEffect(() => {
    setNodes(rfNodes);
  }, [rfNodes, setNodes]);
  useEffect(() => {
    setEdges(rfEdges);
  }, [rfEdges, setEdges]);

  // ノード数が変わったら新しい構造が収まるように寄せる
  const nodeCount = diagram.nodes.length;
  useEffect(() => {
    if (nodeCount > 0) {
      fitView({ padding: 0.25, duration: 600 });
    }
  }, [nodeCount, fitView]);

  // 「整列」: 配置済みの固定を無視して全ノードを並べ直し、結果を永続化する
  const handleArrange = useCallback(() => {
    const positions = computePositions(diagram, {
      derivedEdges: derivedLoopEdges,
      reset: true,
    });
    setNodes((nds) =>
      nds.map((n) => {
        const p = positions.get(n.id);
        return p ? { ...n, position: p } : n;
      }),
    );
    updateNodePositions(
      projectId,
      [...positions].map(([nodeId, p]) => ({ nodeId, x: p.x, y: p.y })),
    );
    // 反映後に全体が画面へ収まるよう次フレームで寄せる
    requestAnimationFrame(() => fitView({ padding: 0.25, duration: 600 }));
  }, [diagram, derivedLoopEdges, setNodes, projectId, fitView]);

  const handlePaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains("react-flow__pane")) return;

      const name = window.prompt("変数の名前を入力してください");
      if (!name?.trim()) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      createNode(projectId, name.trim(), position.x, position.y).then(
        (result) => {
          if (!result.ok) {
            toast.error(result.error ?? "変数を追加できませんでした");
          }
        },
      );
    },
    [projectId, screenToFlowPosition],
  );

  const handleAddNode = useCallback(() => {
    const name = window.prompt("変数の名前を入力してください");
    if (!name?.trim()) return;

    const wrapper = document.querySelector(".react-flow__viewport");
    const rect = wrapper?.closest(".react-flow")?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const position = screenToFlowPosition({ x: cx, y: cy });

    createNode(projectId, name.trim(), position.x, position.y).then(
      (result) => {
        if (!result.ok) {
          toast.error(result.error ?? "変数を追加できませんでした");
        }
      },
    );
  }, [projectId, screenToFlowPosition]);

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      createEdge(projectId, connection.source, connection.target, "+").then(
        (result) => {
          if (!result.ok) {
            toast.error(result.error ?? "リンクを追加できませんでした");
          }
        },
      );
    },
    [projectId],
  );

  return (
    <div className="relative size-full">
      <HighlightContext.Provider value={highlight}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          colorMode={mounted && resolvedTheme === "dark" ? "dark" : "light"}
          fitView
          minZoom={0.25}
          maxZoom={1.75}
          nodesConnectable
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
          onConnect={handleConnect}
          onDoubleClick={handlePaneDoubleClick}
          onNodeDragStop={(_, node) => {
            updateNodePosition(
              projectId,
              node.id,
              node.position.x,
              node.position.y,
            );
          }}
          onNodeClick={(_, node) => {
            const found = diagram.nodes.find((n) => n.id === node.id);
            setSelected(found ? { kind: "node", node: found } : null);
          }}
          onEdgeClick={(_, edge) => {
            const found = diagram.edges.find((e) => e.id === edge.id);
            setSelected(found ? { kind: "edge", edge: found } : null);
          }}
          // パネルの開閉は外側 pointerdown ハンドラが担うのでここでは触らない
          onPaneClick={() => setSelected(null)}
        >
          <Background
            variant={BackgroundVariant.Lines}
            gap={28}
            color="var(--grid-line)"
          />
          <Controls showInteractive={false} position="bottom-right" />
          <LoopBadges
            loops={verification.loopResult.loops}
            liveNodes={nodes}
            onHover={highlightLoop}
          />
        </ReactFlow>
      </HighlightContext.Provider>
      <CausalEdgeMarkers />
      <DependencyEdgeMarkers />

      <div className="-translate-x-1/2 absolute top-4 left-1/2 z-10 flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-1.5 shadow-sm"
          onClick={handleAddNode}
        >
          <PlusIcon size={16} weight="bold" />
          変数を追加
        </Button>
        {diagram.nodes.length > 0 && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="gap-1.5 shadow-sm"
            onClick={handleArrange}
          >
            <TreeStructureIcon size={16} weight="bold" />
            整列
          </Button>
        )}
      </div>

      {diagram.nodes.length > 0 && (
        <VerificationPanel
          loopResult={verification.loopResult}
          findings={verification.findings}
          matches={verification.matches}
          candidates={verification.metrics.interventionCandidates}
          open={openPanel === "verification"}
          onToggle={() =>
            setOpenPanel((p) => (p === "verification" ? null : "verification"))
          }
          onHighlightLoop={highlightLoop}
          onHighlightCandidate={highlightCandidate}
          onSelectFinding={selectFinding}
        />
      )}

      {diagram.nodes.length > 0 && (
        <SimulationPanel
          projectId={projectId}
          diagram={diagram}
          simConfig={simConfig}
          open={openPanel === "simulation"}
          onToggle={() =>
            setOpenPanel((p) => (p === "simulation" ? null : "simulation"))
          }
        />
      )}

      {diagram.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-60 text-center text-muted-foreground text-sm leading-relaxed">
            <p>対話が進むと、ここに問題の構造が現れます。</p>
            <p className="mt-2 text-xs">ダブルクリックでも変数を追加できます</p>
          </div>
        </div>
      )}

      {selected && (
        <InspectorPanel
          key={selected.kind === "node" ? selected.node.id : selected.edge.id}
          projectId={projectId}
          selected={selected}
          diagram={diagram}
          kindSuggestion={
            selected.kind === "node"
              ? verification.kindSuggestions.get(selected.node.id)
              : undefined
          }
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
