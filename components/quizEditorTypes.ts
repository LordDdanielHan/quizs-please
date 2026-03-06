export const SUPPORTED_TYPES = [
  "multiple-choice",
  "true-false-1",
  "question-1",
  "essay",
  "sequence",
] as const;

export type QuestionType = (typeof SUPPORTED_TYPES)[number];

export type FlowTarget = string | "end";

export interface AnswerOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface EditorQuestion {
  id: string;
  type: QuestionType;
  body: string;
  options: AnswerOption[];
  sampleSolution: string;
  instruction: string;
  sourceBit: Record<string, unknown>;
}

export type FlowMap = Record<
  string,
  {
    correct: FlowTarget;
    incorrect: FlowTarget;
  }
>;

export type NodePositionMap = Record<string, { x: number; y: number }>;
