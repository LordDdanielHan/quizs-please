import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { QuizData, QuizSubmission, SubmissionListItem, SubmissionTurn } from "./quiz-types";

const submissionsDir = path.join(process.cwd(), "data", "quiz-submissions");

async function ensureDir(): Promise<void> {
  await mkdir(submissionsDir, { recursive: true });
}

function getFilePath(submissionId: string): string {
  return path.join(submissionsDir, `${submissionId}.json`);
}

async function readSubmissionFile(filePath: string): Promise<QuizSubmission> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as QuizSubmission;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function ensureUniqueUserId(baseUserId: string): Promise<string> {
  await ensureDir();
  const entries = await readdir(submissionsDir, { withFileTypes: true });
  const candidatePattern = new RegExp(`^${escapeRegExp(baseUserId)}(?: \\((\\d+)\\))?$`, "i");
  let maxSuffix = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const submission = await readSubmissionFile(path.join(submissionsDir, entry.name));
    const match = submission.userId.match(candidatePattern);
    if (!match) {
      continue;
    }
    const suffixRaw = match[1];
    const suffix = suffixRaw ? Number.parseInt(suffixRaw, 10) : 1;
    maxSuffix = Math.max(maxSuffix, Number.isFinite(suffix) ? suffix : 1);
  }

  if (maxSuffix === 0) {
    return baseUserId;
  }

  return `${baseUserId} (${maxSuffix + 1})`;
}

export async function createSubmission(
  payload: {
    userId: string;
    maxScore: number;
    turns: SubmissionTurn[];
    awardedScore?: number | null;
    awardedMarks?: Record<string, number>;
    quizData?: QuizData;
  }
): Promise<QuizSubmission> {
  await ensureDir();
  const uniqueUserId = await ensureUniqueUserId(payload.userId);
  const submission: QuizSubmission = {
    id: randomUUID(),
    userId: uniqueUserId,
    completedAt: new Date().toISOString(),
    marked: false,
    markedAt: null,
    teacherName: null,
    maxScore: payload.maxScore,
    awardedScore: payload.awardedScore ?? null,
    awardedMarks: payload.awardedMarks ?? {},
    quizData: payload.quizData,
    turns: payload.turns,
  };

  await writeFile(getFilePath(submission.id), JSON.stringify(submission, null, 2), "utf8");
  return submission;
}

export async function listSubmissions(): Promise<SubmissionListItem[]> {
  await ensureDir();
  const entries = await readdir(submissionsDir, { withFileTypes: true });
  const items: SubmissionListItem[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const submission = await readSubmissionFile(path.join(submissionsDir, entry.name));
    const computedScore = Object.values(submission.awardedMarks ?? {}).reduce(
      (sum, mark) => sum + (Number.isFinite(mark) ? Number(mark) : 0),
      0
    );
    items.push({
      id: submission.id,
      userId: submission.userId,
      completedAt: submission.completedAt,
      marked: submission.marked,
      markedAt: submission.markedAt,
      teacherName: submission.teacherName,
      maxScore: submission.maxScore,
      awardedScore: submission.awardedScore ?? computedScore,
    });
  }

  items.sort(
    (a, b) =>
      new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
  );

  return items;
}

export async function getSubmission(submissionId: string): Promise<QuizSubmission | null> {
  await ensureDir();
  try {
    return await readSubmissionFile(getFilePath(submissionId));
  } catch {
    return null;
  }
}

export async function saveSubmission(submission: QuizSubmission): Promise<void> {
  await ensureDir();
  await writeFile(getFilePath(submission.id), JSON.stringify(submission, null, 2), "utf8");
}
