"use client";

import {
  Background,
  BackgroundVariant,
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
import { TreeStructureIcon } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { matchArchetypes } from "@/lib/diagram/archetypes";
import { isCausallyLinked } from "@/lib/diagram/dependencies";
import { deriveSignedDependencies } from "@/lib/diagram/dependency-polarity";
import { type LintFinding, lintDiagram } from "@/lib/diagram/lint";
import { detectLoops, type Loop } from "@/lib/diagram/loops";
import type { Diagram, DiagramEdge, DiagramNode } from "@/lib/queries/diagrams";
import { updateNodePosition, updateNodePositions } from "../_actions";
import { CausalEdge, CausalEdgeMarkers } from "./causal-edge";
import { DependencyEdge, DependencyEdgeMarkers } from "./dependency-edge";
import { chooseBulgeSigns } from "./floating-edge-utils";
import { type Highlight, HighlightContext } from "./highlight-context";
import { InspectorPanel } from "./inspector-panel";
import { computePositions } from "./layout-diagram";
import { LoopBadges } from "./loop-badges";
import { SimulationPanel } from "./simulation-panel";
import { VariableNode } from "./variable-node";
import { VerificationPanel } from "./verification-panel";

const nodeTypes = { variable: VariableNode };
const edgeTypes = { causal: CausalEdge, dependency: DependencyEdge };

type DiagramCanvasProps = {
  projectId: string;
  diagram: Diagram;
};

export function DiagramCanvas(props: DiagramCanvasProps) {
  return (
    <ReactFlowProvider>
      <DiagramCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function DiagramCanvasInner({ projectId, diagram }: DiagramCanvasProps) {
  const { fitView } = useReactFlow();
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

  // 式の依存（情報リンク）のうち、同方向の因果エッジが無いもの。破線描画とループ参加の
  // 両方でこの同一集合を使い「破線 ⟺ ループ参加リンク」を一致させる（保存せず毎回導出）
  const signedDeps = useMemo(
    () =>
      deriveSignedDependencies(diagram.nodes).filter(
        (dep) => !isCausallyLinked(dep.fromNodeId, dep.toNodeId, diagram.edges),
      ),
    [diagram],
  );

  // 情報リンクを「レイアウト・ループ検出」用の派生エッジ形に正規化する。
  // 同じ集合を computePositions（レイアウト）とループ検出の両方に渡す
  const derivedLoopEdges = useMemo(
    () =>
      signedDeps.map((dep) => ({
        id: dep.id,
        sourceNodeId: dep.fromNodeId,
        targetNodeId: dep.toNodeId,
        polarity: dep.polarity,
        hasDelay: false,
        derived: true as const,
      })),
    [signedDeps],
  );

  // ループ・lint・原型は図から毎回導出する（保存しない）。ループ検出には因果エッジに加えて
  // 式由来リンクも derived エッジとして渡し、式で閉じる円環を暫定ループとして拾う
  const verification = useMemo(() => {
    const loopEdges = [...diagram.edges, ...derivedLoopEdges];
    const loopResult = detectLoops(diagram.nodes, loopEdges);
    return {
      loopResult,
      findings: lintDiagram(diagram.nodes, diagram.edges),
      matches: matchArchetypes(loopResult.loops),
    };
  }, [diagram, derivedLoopEdges]);

  const [highlight, setHighlight] = useState<Highlight>(null);
  const highlightLoop = useCallback((loop: Loop | null) => {
    setHighlight(
      loop
        ? { nodeIds: new Set(loop.nodeIds), edgeIds: new Set(loop.edgeIds) }
        : null,
    );
  }, []);

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
    const bulgeSigns = chooseBulgeSigns(diagram.edges, positions);
    // 情報リンクも因果エッジと同じノード回避ロジックで曲げる（固定の片側曲げをやめ、
    // 他ノードから遠い側へ逃がして重なりを減らす）。因果側の bulge には影響させない
    const depBulgeSigns = chooseBulgeSigns(
      signedDeps.map((dep) => ({
        id: dep.id,
        sourceNodeId: dep.fromNodeId,
        targetNodeId: dep.toNodeId,
      })),
      positions,
    );
    const causalEdges = diagram.edges.map(
      (edge): Edge => ({
        id: edge.id,
        type: "causal",
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        data: { edge, bulgeSign: bulgeSigns.get(edge.id) ?? 1 },
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
        data: { bulgeSign: depBulgeSigns.get(dep.id) ?? 1 },
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
  }, [diagram, signedDeps, derivedLoopEdges]);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: nodeCount 変化時のみ実行する
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
          nodesConnectable={false}
          deleteKeyCode={null}
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

      {diagram.nodes.length > 0 && (
        <div className="-translate-x-1/2 absolute top-4 left-1/2 z-10">
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
        </div>
      )}

      {diagram.nodes.length > 0 && (
        <VerificationPanel
          loopResult={verification.loopResult}
          findings={verification.findings}
          matches={verification.matches}
          onHighlightLoop={highlightLoop}
          onSelectFinding={selectFinding}
        />
      )}

      {diagram.nodes.length > 0 && <SimulationPanel diagram={diagram} />}

      {diagram.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <p className="max-w-60 text-center text-muted-foreground text-sm leading-relaxed">
            対話が進むと、ここに問題の構造が現れます。
          </p>
        </div>
      )}

      {selected && (
        <InspectorPanel
          key={selected.kind === "node" ? selected.node.id : selected.edge.id}
          projectId={projectId}
          selected={selected}
          diagram={diagram}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
