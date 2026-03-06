"use client";

import { useMemo } from "react";
import ReactFlow, {
  Background,
  Edge,
  MarkerType,
  Node,
  ReactFlowProvider,
} from "reactflow";
import styles from "@/styles/quiz-editor.module.css";
import { FlowMap, NodePositionMap, Turn } from "./quizEditorTypes";

interface FlowEditorProps {
  turns: Turn[];
  flow: FlowMap;
  nodePositions: NodePositionMap;
  onEditEdge: (sourceTurnId: string, branchType: "correct" | "incorrect") => void;
}

function FlowCanvas({ turns, flow, nodePositions, onEditEdge }: FlowEditorProps) {
  const nodes = useMemo<Node[]>(() => {
    const turnNodes: Node[] = turns.map((turn, index) => {
      const position = nodePositions[turn.id] ?? { x: 250, y: index * 160 };
      const questionCount = turn.questions.length;
      const questionLabel = questionCount === 1 ? "question" : "questions";
      return {
        id: turn.id,
        type: "default",
        position,
        data: { label: `${turn.label} - ${questionCount} ${questionLabel}` },
      };
    });

    const endY = Math.max(180, turns.length * 160 + 60);
    return [
      ...turnNodes,
      {
        id: "end",
        type: "output",
        position: { x: 250, y: endY },
        draggable: false,
        data: { label: "End" },
      },
    ];
  }, [nodePositions, turns]);

  const edges = useMemo<Edge[]>(() => {
    if (turns.length === 0) {
      return [];
    }

    return turns.flatMap<Edge>((turn, index) => {
      const defaultCorrect = turns[index + 1]?.id ?? "end";
      const branch = flow[turn.id] ?? { correct: defaultCorrect, incorrect: "end" };

      return [
        {
          id: `${turn.id}::correct`,
          source: turn.id,
          target: branch.correct,
          label: "✓ Correct",
          style: { stroke: "#1e7d34", strokeWidth: 2 },
          labelStyle: { fill: "#1e7d34", fontWeight: 700 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#1e7d34" },
        },
        {
          id: `${turn.id}::incorrect`,
          source: turn.id,
          target: branch.incorrect,
          label: "✗ Incorrect",
          style: { stroke: "#bd2c2c", strokeWidth: 2 },
          labelStyle: { fill: "#bd2c2c", fontWeight: 700 },
          markerEnd: { type: MarkerType.ArrowClosed, color: "#bd2c2c" },
        },
      ];
    });
  }, [flow, turns]);

  return (
    <div className={styles.flowCanvas}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        nodesDraggable={false}
        onEdgeClick={(_, edge) => {
          const [sourceId, branchType] = edge.id.split("::");
          if (sourceId && (branchType === "correct" || branchType === "incorrect")) {
            onEditEdge(sourceId, branchType);
          }
        }}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}

export default function FlowEditor(props: FlowEditorProps) {
  return (
    <div className={styles.flowContainer}>
      <ReactFlowProvider>
        <FlowCanvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
