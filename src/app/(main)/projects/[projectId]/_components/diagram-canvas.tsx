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
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useState } from "react";
import { matchArchetypes } from "@/lib/diagram/archetypes";
import { type LintFinding, lintDiagram } from "@/lib/diagram/lint";
import { detectLoops, type Loop } from "@/lib/diagram/loops";
import type { Diagram, DiagramEdge, DiagramNode } from "@/lib/queries/diagrams";
import { updateNodePosition } from "../_actions";
import { CausalEdge, CausalEdgeMarkers } from "./causal-edge";
import { chooseBulgeSigns } from "./floating-edge-utils";
import { type Highlight, HighlightContext } from "./highlight-context";
import { InspectorPanel } from "./inspector-panel";
import { computePositions } from "./layout-diagram";
import { LoopBadges } from "./loop-badges";
import { VariableNode } from "./variable-node";
import { VerificationPanel } from "./verification-panel";

const nodeTypes = { variable: VariableNode };
const edgeTypes = { causal: CausalEdge };

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

  // ループ・lint・原型は図から毎回導出する（保存しない）
  const verification = useMemo(() => {
    const loopResult = detectLoops(diagram.nodes, diagram.edges);
    return {
      loopResult,
      findings: lintDiagram(diagram.nodes, diagram.edges),
      matches: matchArchetypes(loopResult.loops),
    };
  }, [diagram]);

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
    const positions = computePositions(diagram);
    const bulgeSigns = chooseBulgeSigns(diagram.edges, positions);
    return {
      rfNodes: diagram.nodes.map(
        (node): Node => ({
          id: node.id,
          type: "variable",
          position: positions.get(node.id) ?? { x: 0, y: 0 },
          data: { node },
        }),
      ),
      rfEdges: diagram.edges.map(
        (edge): Edge => ({
          id: edge.id,
          type: "causal",
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
          data: { edge, bulgeSign: bulgeSigns.get(edge.id) ?? 1 },
        }),
      ),
    };
  }, [diagram]);

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

      {diagram.nodes.length > 0 && (
        <VerificationPanel
          loopResult={verification.loopResult}
          findings={verification.findings}
          matches={verification.matches}
          onHighlightLoop={highlightLoop}
          onSelectFinding={selectFinding}
        />
      )}

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
