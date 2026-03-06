export const SUPPORTED_TYPES = [
  "multiple-choice-1",
  "multiple-response-1",
  "essay",
  "match",
] as const;

export type QuestionType = (typeof SUPPORTED_TYPES)[number];

export type FlowTarget = string | "end";

export interface AnswerOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface MatchPair {
  id: string;
  left: string;
  right: string;
}

export interface EditorQuestion {
  id: string;
  type: QuestionType;
  body: string;
  options: AnswerOption[];
  sampleAnswer: string;
  pairs: MatchPair[];
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

