import { NextResponse } from "next/server";
import quizData from "@/app/quiz/quiz-data.json";
import { isAnswerCorrect, isAutoGradableQuestion } from "@/lib/quiz-grading";
import {
  getSubmission,
  saveSubmission,
} from "@/lib/quiz-submission-store";
import type { QuizData, QuizQuestion } from "@/lib/quiz-types";

export const runtime = "nodejs";

interface MarkSubmissionBody {
  teacherName?: string;
  awardedMarks?: Record<string, number>;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  const { submissionId } = await context.params;
  const submission = await getSubmission(submissionId);

  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  return NextResponse.json({ submission });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ submissionId: string }> }
) {
  const { submissionId } = await context.params;
  const submission = await getSubmission(submissionId);
  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  const body = (await request.json()) as MarkSubmissionBody;
  const awardedMarks = body.awardedMarks ?? {};
  const teacherName = (body.teacherName ?? "").trim();
  const fallbackData = quizData as QuizData;
  const data = submission.quizData ?? fallbackData;
  const questionById = new Map<string, QuizQuestion>();
  for (const turn of data.turns) {
    for (const question of turn.questions) {
      questionById.set(question.id, question);
    }
  }

  let awardedScore = 0;
  for (const turn of submission.turns) {
    for (const question of turn.questions) {
      const sourceQuestion = questionById.get(question.questionId);
      let clamped = 0;

      if (sourceQuestion && isAutoGradableQuestion(sourceQuestion)) {
        clamped = isAnswerCorrect(sourceQuestion, question.answer) ? question.marks : 0;
      } else {
        const rawValue = awardedMarks[question.questionId];
        const numeric = Number.isFinite(rawValue) ? Number(rawValue) : 0;
        clamped = Math.max(0, Math.min(question.marks, numeric));
      }

      submission.awardedMarks[question.questionId] = clamped;
      awardedScore += clamped;
    }
  }

  submission.awardedScore = awardedScore;
  submission.marked = true;
  submission.markedAt = new Date().toISOString();
  submission.teacherName = teacherName || null;

  await saveSubmission(submission);

  return NextResponse.json({ submission });
}
