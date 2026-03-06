import { NextResponse } from "next/server";
import quizData from "@/app/quiz/quiz-data.json";
import {
  createSubmission,
  listSubmissions,
} from "@/lib/quiz-submission-store";
import { isAnswerCorrect, isAutoGradableQuestion } from "@/lib/quiz-grading";
import type { AnswerValue, QuizData, SubmissionTurn } from "@/lib/quiz-types";

export const runtime = "nodejs";

interface CreateSubmissionBody {
  userId?: string;
  answers?: Record<string, AnswerValue>;
}

export async function GET() {
  const submissions = await listSubmissions();
  return NextResponse.json({ submissions });
}

export async function POST(request: Request) {
  const body = (await request.json()) as CreateSubmissionBody;
  const userId = (body.userId ?? "").trim();
  const answers = body.answers ?? {};

  if (!userId) {
    return NextResponse.json(
      { error: "userId is required" },
      { status: 400 }
    );
  }

  const data = quizData as QuizData;
  const awardedMarks: Record<string, number> = {};
  let awardedScore = 0;
  const turns: SubmissionTurn[] = data.turns.map((turn) => ({
    turnId: turn.id,
    turnLabel: turn.label,
    questions: turn.questions.map((question) => {
      const answer = answers[question.id] ?? null;
      if (isAutoGradableQuestion(question)) {
        const score = isAnswerCorrect(question, answer) ? question.marks : 0;
        awardedMarks[question.id] = score;
        awardedScore += score;
      }
      return {
        questionId: question.id,
        prompt: question.prompt,
        kind: question.kind,
        marks: question.marks,
        idealAnswer: question.idealAnswer,
        answer,
      };
    }),
  }));

  const maxScore = turns.reduce(
    (sum, turn) =>
      sum + turn.questions.reduce((sub, q) => sub + q.marks, 0),
    0
  );

  const submission = await createSubmission({
    userId,
    maxScore,
    turns,
    awardedMarks,
    awardedScore,
  });

  return NextResponse.json({
    submissionId: submission.id,
    completedAt: submission.completedAt,
    userId: submission.userId,
  });
}
