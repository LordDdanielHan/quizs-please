import type { AnswerValue, QuizQuestion } from "./quiz-types";

const autoGradableKinds = new Set<QuizQuestion["kind"]>([
  "cloze",
  "multiple-choice",
  "multiple-choice-text",
  "multiple-response",
  "match",
  "true-false",
  "sequence",
  "vocabulary",
]);

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseNumberish(value: string): number | null {
  const normalized = value.replace(/[%\s,]/g, "");
  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function sameTextOrNumber(expected: string, answer: string): boolean {
  const expectedNumeric = parseNumberish(expected);
  const answerNumeric = parseNumberish(answer);
  if (expectedNumeric !== null && answerNumeric !== null) {
    return Math.abs(expectedNumeric - answerNumeric) < 1e-9;
  }
  return normalizeToken(expected) === normalizeToken(answer);
}

export function isAutoGradableQuestion(question: QuizQuestion): boolean {
  return autoGradableKinds.has(question.kind) && question.expected !== undefined;
}

export function isAnswerCorrect(question: QuizQuestion, answer: AnswerValue | null | undefined): boolean {
  if (!isAutoGradableQuestion(question)) {
    return false;
  }

  const expected = question.expected;
  if (question.kind === "multiple-response") {
    if (!Array.isArray(expected) || !Array.isArray(answer)) {
      return false;
    }
    const expectedSet = new Set(expected.map((item) => normalizeToken(String(item))));
    const answerSet = new Set(answer.map((item) => normalizeToken(String(item))));
    if (expectedSet.size !== answerSet.size) {
      return false;
    }
    for (const value of expectedSet) {
      if (!answerSet.has(value)) {
        return false;
      }
    }
    return true;
  }

  if (question.kind === "match") {
    if (
      !expected ||
      typeof expected !== "object" ||
      Array.isArray(expected) ||
      !answer ||
      typeof answer !== "object" ||
      Array.isArray(answer)
    ) {
      return false;
    }
    const expectedMap = expected as Record<string, string>;
    const answerMap = answer as Record<string, string>;
    return Object.entries(expectedMap).every(
      ([left, right]) => normalizeToken(answerMap[left] ?? "") === normalizeToken(right)
    );
  }

  if (question.kind === "sequence") {
    if (!Array.isArray(expected) || !Array.isArray(answer) || expected.length !== answer.length) {
      return false;
    }
    return expected.every((value, index) => normalizeToken(String(value)) === normalizeToken(String(answer[index])));
  }

  if (typeof expected === "string" && typeof answer === "string") {
    return sameTextOrNumber(expected, answer);
  }

  return false;
}
