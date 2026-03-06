"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import quizDataJson from "@/app/quiz/quiz-data.json";
import { isAnswerCorrect, isAutoGradableQuestion } from "@/lib/quiz-grading";
import { coerceQuizData, parseRuntimeQuizData, QUIZ_RUNTIME_SESSION_KEY } from "@/lib/quiz-runtime";
import type {
  DocumentDropAnswer,
  HighlightStroke,
  QuizData,
  QuizQuestion,
  QuizSubmission,
  SubmissionListItem,
} from "@/lib/quiz-types";

const fallbackQuiz = quizDataJson as QuizData;
const QUIZ_EDITOR_SESSION_KEY = "quiz-editor:questions";

function isDocumentDropAnswer(
  answer: QuizSubmission["turns"][number]["questions"][number]["answer"]
): answer is DocumentDropAnswer {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    return false;
  }
  return (answer as DocumentDropAnswer).type === "document-drop";
}

function buildStrokePath(stroke: HighlightStroke): string {
  if (stroke.points.length === 0) {
    return "";
  }
  const [first, ...rest] = stroke.points;
  return `M ${first.x} ${first.y} ${rest.map((point) => `L ${point.x} ${point.y}`).join(" ")}`;
}

function formatAnswer(answer: QuizSubmission["turns"][number]["questions"][number]["answer"]): string {
  if (answer === null || answer === undefined) {
    return "No answer";
  }
  if (isDocumentDropAnswer(answer)) {
    return `Dropped: ${answer.title} (${answer.highlights.length} highlights)`;
  }
  if (typeof answer === "string") {
    return answer || "No answer";
  }
  if (Array.isArray(answer)) {
    return answer.join(", ");
  }
  return Object.entries(answer)
    .map(([left, right]) => `${left} => ${right}`)
    .join("; ");
}

function buildQuestionMap(quiz: QuizData): Map<string, QuizQuestion> {
  const map = new Map<string, QuizQuestion>();
  for (const turn of quiz.turns) {
    for (const question of turn.questions) {
      map.set(question.id, question);
    }
  }
  return map;
}

async function parseApiJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(
      `Expected JSON from ${response.url} (status ${response.status}), received: ${preview || "<empty>"}`
    );
  }
}

export default function QuizReviewPage() {
  const [submissions, setSubmissions] = useState<SubmissionListItem[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string>("");
  const [submission, setSubmission] = useState<QuizSubmission | null>(null);
  const [awardedMarks, setAwardedMarks] = useState<Record<string, number>>({});
  const [teacherName, setTeacherName] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingSubmission, setLoadingSubmission] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sessionQuiz, setSessionQuiz] = useState<QuizData | null>(null);

  const activeQuiz = useMemo(
    () => coerceQuizData(submission?.quizData) ?? sessionQuiz ?? fallbackQuiz,
    [sessionQuiz, submission?.quizData]
  );

  const users = useMemo(() => {
    const ids = new Set(submissions.map((item) => item.userId));
    return Array.from(ids).sort();
  }, [submissions]);

  const filteredSubmissions = useMemo(() => {
    if (selectedUser === "all") {
      return submissions;
    }
    return submissions.filter((item) => item.userId === selectedUser);
  }, [selectedUser, submissions]);

  const questionById = useMemo(() => buildQuestionMap(activeQuiz), [activeQuiz]);
  const quizMaxScore = useMemo(
    () =>
      activeQuiz.turns.reduce(
        (turnSum, turn) => turnSum + turn.questions.reduce((questionSum, question) => questionSum + question.marks, 0),
        0
      ),
    [activeQuiz]
  );

  const getAutoMark = useCallback(
    (questionId: string, answer: QuizSubmission["turns"][number]["questions"][number]["answer"]): number | null => {
      const question = questionById.get(questionId);
      if (!question || !isAutoGradableQuestion(question)) {
        return null;
      }
      return isAnswerCorrect(question, answer) ? question.marks : 0;
    },
    [questionById]
  );

  const totalScore = useMemo(() => {
    if (!submission) {
      return 0;
    }
    let total = 0;
    for (const turn of submission.turns) {
      for (const question of turn.questions) {
        const auto = getAutoMark(question.questionId, question.answer);
        total += awardedMarks[question.questionId] ?? auto ?? 0;
      }
    }
    return total;
  }, [awardedMarks, getAutoMark, submission]);

  const loadList = useCallback(async (): Promise<void> => {
    setLoadingList(true);
    setError("");
    try {
      const response = await fetch("/api/quiz/submissions", { cache: "no-store" });
      const payload = await parseApiJson<{ submissions?: SubmissionListItem[]; error?: string }>(response);
      if (!response.ok || !payload.submissions) {
        throw new Error(payload.error || "Failed to load submissions");
      }
      const list = payload.submissions;
      setSubmissions(list);
      setSelectedId((prev) => prev || list[0]?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to load submissions");
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadSubmission = useCallback(
    async (submissionId: string): Promise<void> => {
      if (!submissionId) {
        return;
      }
      setLoadingSubmission(true);
      setError("");
      try {
        const response = await fetch(`/api/quiz/submissions/${submissionId}`, { cache: "no-store" });
        const payload = await parseApiJson<{ submission?: QuizSubmission; error?: string }>(response);
        if (!response.ok || !payload.submission) {
          throw new Error(payload.error || "Failed to load submission");
        }

        const normalizedQuiz =
          coerceQuizData(payload.submission.quizData) ?? sessionQuiz ?? fallbackQuiz;
        const normalizedSubmission: QuizSubmission = {
          ...payload.submission,
          quizData: normalizedQuiz,
        };

        setSubmission(normalizedSubmission);
        setTeacherName(normalizedSubmission.teacherName ?? "");

        const mergedMarks = { ...(normalizedSubmission.awardedMarks ?? {}) };
        const questionMap = buildQuestionMap(normalizedQuiz);
        for (const turn of normalizedSubmission.turns) {
          for (const question of turn.questions) {
            const sourceQuestion = questionMap.get(question.questionId);
            if (!sourceQuestion || !isAutoGradableQuestion(sourceQuestion)) {
              continue;
            }
            mergedMarks[question.questionId] = isAnswerCorrect(sourceQuestion, question.answer)
              ? question.marks
              : 0;
          }
        }
        setAwardedMarks(mergedMarks);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Failed to load submission");
      } finally {
        setLoadingSubmission(false);
      }
    },
    [sessionQuiz]
  );

  async function saveMarks(): Promise<void> {
    if (!submission) {
      return;
    }

    const normalizedMarks = { ...awardedMarks };
    for (const turn of submission.turns) {
      for (const question of turn.questions) {
        const auto = getAutoMark(question.questionId, question.answer);
        if (auto !== null) {
          normalizedMarks[question.questionId] = auto;
        }
      }
    }
    setAwardedMarks(normalizedMarks);

    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/quiz/submissions/${submission.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherName, awardedMarks: normalizedMarks }),
      });
      const payload = await parseApiJson<{ submission?: QuizSubmission; error?: string }>(response);
      if (!response.ok || !payload.submission) {
        throw new Error(payload.error || "Failed to save marks");
      }
      setSubmission({
        ...payload.submission,
        quizData: coerceQuizData(payload.submission.quizData) ?? activeQuiz,
      });
      await loadList();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Failed to save marks");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const parsed =
      parseRuntimeQuizData(window.sessionStorage.getItem(QUIZ_RUNTIME_SESSION_KEY)) ??
      parseRuntimeQuizData(window.sessionStorage.getItem(QUIZ_EDITOR_SESSION_KEY));
    if (parsed) {
      setSessionQuiz(parsed);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) {
      void loadSubmission(selectedId);
    }
  }, [loadSubmission, selectedId]);

  useEffect(() => {
    if (filteredSubmissions.length === 0) {
      setSelectedId("");
      setSubmission(null);
      return;
    }
    if (!filteredSubmissions.some((entry) => entry.id === selectedId)) {
      setSelectedId(filteredSubmissions[0].id);
    }
  }, [filteredSubmissions, selectedId]);

  return (
    <div className="font-body min-h-screen bg-[#14100d] text-[#efe1bf]">
      <header className="flex items-end justify-between border-b border-[#4d3f2e] bg-[#1d1511] px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#bda87e]">Teacher Console</p>
          <h1 className="font-title text-3xl uppercase tracking-[0.08em]">Manual Quiz Review</h1>
        </div>
        <label className="text-xs uppercase tracking-[0.1em] text-[#bea87f]">
          Filter by user
          <select
            value={selectedUser}
            onChange={(event) => setSelectedUser(event.target.value)}
            className="ml-2 rounded border border-[#67533d] bg-[#261b14] px-2 py-1 text-sm text-[#f2e6c8]"
          >
            <option value="all">All users</option>
            {users.map((user) => (
              <option key={user} value={user}>
                {user}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="grid min-h-[calc(100vh-88px)] grid-cols-1 lg:grid-cols-[360px_1fr]">
        <aside className="border-r border-[#4d3f2e] bg-[#1b1511] p-3">
          <h2 className="mb-2 text-xs uppercase tracking-[0.12em] text-[#b99f73]">Submissions</h2>
          {loadingList ? <p className="text-sm text-[#cdbf9d]">Loading...</p> : null}
          <div className="space-y-2">
            {filteredSubmissions.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`w-full rounded border px-3 py-2 text-left ${
                  selectedId === item.id
                    ? "border-[#c6ad7b] bg-[#3b2b1f]"
                    : "border-[#5f4c35] bg-[#251c15]"
                }`}
              >
                <p className="text-sm font-semibold text-[#f2e5c6]">{item.userId}</p>
                <p className="text-xs text-[#cfbf98]">{new Date(item.completedAt).toLocaleString()}</p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-[#b59b70]">
                  {item.marked ? "Marked" : "Unmarked"}
                  {item.awardedScore !== null ? ` - ${item.awardedScore}/${item.maxScore}` : ""}
                </p>
              </button>
            ))}
          </div>
        </aside>

        <section className="p-4">
          {error ? <p className="mb-3 text-sm text-[#db8375]">{error}</p> : null}
          {loadingSubmission ? <p className="text-sm text-[#d3c29d]">Loading submission...</p> : null}
          {!submission && !loadingSubmission ? (
            <p className="text-sm text-[#d3c29d]">Select a submission to start marking.</p>
          ) : null}

          {submission ? (
            <div className="space-y-4">
              <div className="rounded border border-[#5d4c36] bg-[#211813] p-3">
                <p className="text-sm">
                  <span className="text-[#bca57b]">User:</span> {submission.userId}
                </p>
                <p className="text-sm">
                  <span className="text-[#bca57b]">Completed:</span>{" "}
                  {new Date(submission.completedAt).toLocaleString()}
                </p>
                <p className="text-sm">
                  <span className="text-[#bca57b]">Status:</span> {submission.marked ? "Marked" : "Unmarked"}
                </p>
                <p className="text-sm">
                  <span className="text-[#bca57b]">Questionnaire Total Mark:</span> {totalScore}/{quizMaxScore}
                </p>
                <p className="text-sm">
                  <span className="text-[#bca57b]">Saved Total Mark:</span>{" "}
                  {(submission.awardedScore ?? totalScore)}/{quizMaxScore}
                </p>
                <label className="mt-2 block text-xs uppercase tracking-[0.1em] text-[#bca57b]">
                  Teacher Name
                  <input
                    value={teacherName}
                    onChange={(event) => setTeacherName(event.target.value)}
                    className="mt-1 w-full rounded border border-[#66523b] bg-[#19120d] px-2 py-1.5 text-sm text-[#efe1bf]"
                  />
                </label>
              </div>

              {submission.turns.map((turn) => (
                <article key={turn.turnId} className="rounded border border-[#5d4c36] bg-[#211813] p-3">
                  <h3 className="font-title text-2xl uppercase tracking-[0.06em] text-[#f1e2be]">
                    {turn.turnLabel}
                  </h3>
                  <div className="mt-2 space-y-3">
                    {turn.questions.map((question) => {
                      const autoMark = getAutoMark(question.questionId, question.answer);
                      const isAuto = autoMark !== null;
                      const currentMark = awardedMarks[question.questionId] ?? autoMark ?? 0;

                      return (
                        <div key={question.questionId} className="rounded border border-[#5b4a35] bg-[#19120d] p-3">
                          <p className="text-sm text-[#ecdcb7]">{question.prompt}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.08em] text-[#b79d70]">
                            {question.kind} - max {question.marks}
                          </p>
                          <p className="mt-1 text-xs text-[#d6c7a2]">
                            Score: {currentMark}/{question.marks}
                          </p>
                          {isAuto ? (
                            <p className="mt-1 text-[11px] uppercase tracking-[0.08em] text-[#95c784]">Auto-graded</p>
                          ) : null}
                          <p className="mt-2 text-sm text-[#d9caa7]">
                            <span className="text-[#b79d70]">Answer:</span> {formatAnswer(question.answer)}
                          </p>

                          {isDocumentDropAnswer(question.answer) ? (
                            <div className="mt-2 rounded border border-[#66523b] bg-[#241912] p-2">
                              <p className="text-xs text-[#d9caa7]">
                                Dropped at: {new Date(question.answer.droppedAt).toLocaleString()}
                              </p>
                              {question.answer.compositedImageDataUrl || question.answer.imageSrc ? (
                                <div className="relative mt-2 overflow-hidden rounded border border-[#6b593f]">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={question.answer.compositedImageDataUrl ?? question.answer.imageSrc}
                                    alt={question.answer.title}
                                    className="max-h-72 w-full object-contain"
                                  />
                                  {!question.answer.compositedImageDataUrl ? (
                                    <svg
                                      className="pointer-events-none absolute inset-0 h-full w-full"
                                      viewBox="0 0 1 1"
                                      preserveAspectRatio="none"
                                    >
                                      {question.answer.highlights.map((stroke) => (
                                        <path
                                          key={stroke.id}
                                          d={buildStrokePath(stroke)}
                                          fill="none"
                                          stroke={stroke.color}
                                          strokeWidth={stroke.width / 260}
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      ))}
                                    </svg>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {question.idealAnswer ? (
                            <p className="mt-1 text-xs text-[#bfae89]">Ideal: {question.idealAnswer}</p>
                          ) : null}

                          <label className="mt-2 block text-xs uppercase tracking-[0.08em] text-[#b79d70]">
                            Awarded marks
                            <input
                              type="number"
                              min={0}
                              max={question.marks}
                              value={currentMark}
                              disabled={isAuto}
                              onChange={(event) =>
                                setAwardedMarks((prev) => ({
                                  ...prev,
                                  [question.questionId]: Number(event.target.value),
                                }))
                              }
                              className={`mt-1 w-28 rounded border px-2 py-1 text-sm ${
                                isAuto
                                  ? "border-[#4f6b45] bg-[#1b2a16] text-[#bde0af]"
                                  : "border-[#66523b] bg-[#231912] text-[#f0e2c1]"
                              }`}
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </article>
              ))}

              <button
                type="button"
                onClick={() => void saveMarks()}
                disabled={saving}
                className="w-full rounded border border-[#7f6748] bg-[#8e734e] px-4 py-2 text-sm font-bold text-[#1e160f] disabled:opacity-40"
              >
                {saving ? "Saving..." : "Save Final Score"}
              </button>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}
