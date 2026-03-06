export type QuestionKind =
  | "cloze"
  | "multiple-choice"
  | "multiple-choice-text"
  | "multiple-response"
  | "match"
  | "match-matrix"
  | "match-picture"
  | "match-audio"
  | "true-false"
  | "sequence"
  | "essay"
  | "interview"
  | "assignment"
  | "document-upload"
  | "flashcard"
  | "vocabulary";

export type DocumentType =
  | "memo"
  | "newspaper"
  | "image"
  | "table"
  | "spreadsheet"
  | "transcript"
  | "checklist";

export type QuizToolId =
  | "calculator"
  | "notepad"
  | "converter"
  | "highlighter"
  | "eraser";

export interface HighlightPoint {
  x: number;
  y: number;
}

export interface HighlightStroke {
  id: string;
  points: HighlightPoint[];
  color: string;
  width: number;
}

export interface DocumentDropAnswer {
  type: "document-drop";
  docId: string;
  title: string;
  imageSrc?: string;
  compositedImageDataUrl?: string;
  droppedAt: string;
  highlights: HighlightStroke[];
}

export type AnswerValue = string | string[] | Record<string, string> | DocumentDropAnswer;

export interface QuizTable {
  columns: string[];
  rows: string[][];
}

export interface QuizDocument {
  id: string;
  title: string;
  type: DocumentType;
  persistent?: boolean;
  width?: number;
  height?: number;
  content?: string;
  caption?: string;
  imageSrc?: string;
  imagePrompt?: string;
  filePath?: string;
  table?: QuizTable;
  entries?: string[];
  items?: string[];
  headline?: string;
  subhead?: string;
  byline?: string;
  publishDate?: string;
  columns?: string[];
}

export interface QuizQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  marks: number;
  options?: string[];
  expected?: string | string[] | Record<string, string>;
  idealAnswer?: string;
  usesDocuments?: string[];
  tools?: QuizToolId[];
  matchLeft?: string[];
  matchRight?: string[];
  sequencePool?: string[];
}

export interface QuizTurn {
  id: string;
  label: string;
  briefing: string;
  documents: QuizDocument[];
  questions: QuizQuestion[];
}

export interface QuizData {
  title: string;
  turns: QuizTurn[];
}

export interface SubmissionQuestion {
  questionId: string;
  prompt: string;
  kind: QuestionKind;
  marks: number;
  idealAnswer?: string;
  answer: AnswerValue | null;
}

export interface SubmissionTurn {
  turnId: string;
  turnLabel: string;
  questions: SubmissionQuestion[];
}

export interface QuizSubmission {
  id: string;
  userId: string;
  completedAt: string;
  marked: boolean;
  markedAt: string | null;
  teacherName: string | null;
  maxScore: number;
  awardedScore: number | null;
  awardedMarks: Record<string, number>;
  quizData?: QuizData;
  turns: SubmissionTurn[];
}

export interface SubmissionListItem {
  id: string;
  userId: string;
  completedAt: string;
  marked: boolean;
  markedAt: string | null;
  teacherName: string | null;
  maxScore: number;
  awardedScore: number | null;
}
