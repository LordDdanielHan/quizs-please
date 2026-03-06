"use client";

import { useMemo } from "react";
import ReactFlow, {
  Background,
  Edge,
  Node,
  NodeChange,
  applyNodeChanges,
} from "reactflow";
import styles from "@/styles/quiz-editor.module.css";
import { EditorQuestion, FlowMap, NodePositionMap } from "./quizEditorTypes";

interface FlowEditorProps {
  questions: EditorQuestion[];
  flow: FlowMap;
  nodePositions: NodePositionMap;
  onPositionsChange: (nextPositions: NodePositionMap) => void;
  onEditEdge: (sourceQuestionId: string, branchType: "correct" | "incorrect") => void;
}

export default function FlowEditor({
  questions,
  flow,
  nodePositions,
  onPositionsChange,
  onEditEdge,
}: FlowEditorProps) {
  const nodes = useMemo<Node[]>(() => {
    const questionNodes: Node[] = questions.map((question, index) => ({
      id: question.id,
      type: "default",
      position: nodePositions[question.id] ?? { x: 220, y: 100 + index * 120 },
      data: { label: `Q${index + 1}: ${question.body || "(Untitled question)"}` },
    }));

    return [
      {
        id: "start",
        type: "input",
        position: { x: 20, y: 20 },
        draggable: false,
        data: { label: "Start" },
      },
      ...questionNodes,
      {
        id: "end",
        type: "output",
        position: { x: 620, y: Math.max(120, questions.length * 120 + 40) },
        draggable: false,
        data: { label: "End" },
      },
    ];
  }, [nodePositions, questions]);

  const edges = useMemo<Edge[]>(() => {
    const firstTarget = questions[0]?.id ?? "end";
    const startEdge: Edge = {
      id: "start-edge",
      source: "start",
      target: firstTarget,
      animated: true,
      style: { stroke: "#333" },
      label: "Start",
    };

    const questionEdges = questions.flatMap<Edge>((question) => {
      const branch = flow[question.id] ?? { correct: "end", incorrect: "end" };
      return [
        {
          id: `${question.id}::correct`,
          source: question.id,
          target: branch.correct,
          label: "Correct",
          style: { stroke: "#1e7d34", strokeWidth: 2 },
          labelStyle: { fill: "#1e7d34", fontWeight: 700 },
        },
        {
          id: `${question.id}::incorrect`,
          source: question.id,
          target: branch.incorrect,
          label: "Incorrect",
          style: { stroke: "#bd2c2c", strokeWidth: 2 },
          labelStyle: { fill: "#bd2c2c", fontWeight: 700 },
        },
      ];
    });

    return [startEdge, ...questionEdges];
  }, [flow, questions]);

  const handleNodesChange = (changes: NodeChange[]) => {
    const nextNodes = applyNodeChanges(changes, nodes);
    const nextPositions: NodePositionMap = { ...nodePositions };
    nextNodes.forEach((node) => {
      if (node.id !== "start" && node.id !== "end") {
        nextPositions[node.id] = node.position;
      }
    });
    onPositionsChange(nextPositions);
  };

  return (
    <div className={styles.flowContainer}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        onNodesChange={handleNodesChange}
        onEdgeClick={(_, edge) => {
          if (edge.id === "start-edge") {
            return;
          }
          const [sourceId, branchType] = edge.id.split("::");
          if (
            sourceId &&
            (branchType === "correct" || branchType === "incorrect")
          ) {
            onEditEdge(sourceId, branchType);
          }
        }}
      >
        <Background />
      </ReactFlow>
    </div>
  );
}

