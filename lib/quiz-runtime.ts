import type { QuestionKind, QuizData, QuizDocument, QuizToolId } from "./quiz-types";

export const QUIZ_RUNTIME_SESSION_KEY = "quiz-runtime:data";

const knownKinds = new Set<QuestionKind>([
  "cloze",
  "multiple-choice",
  "multiple-choice-text",
  "multiple-response",
  "match",
  "match-matrix",
  "match-picture",
  "match-audio",
  "true-false",
  "sequence",
  "essay",
  "interview",
  "assignment",
  "document-upload",
  "flashcard",
  "vocabulary",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeBitType(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  const cleaned = raw.replace(/^\./, "");
  return cleaned === "multiple-choice-1" ? "multiple-choice" : cleaned;
}

function rotateSequence(values: string[]): string[] {
  if (values.length <= 1) return values;
  return [...values.slice(1), values[0]];
}

function escapeSvg(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildImagePlaceholderDataUrl(title: string, subtitle: string): string {
  const safeTitle = escapeSvg(title || "Reference Image");
  const safeSubtitle = escapeSvg(subtitle || "Generated visual aid");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2a2f43"/><stop offset="100%" stop-color="#4a5f7a"/></linearGradient></defs><rect width="1200" height="760" fill="url(#bg)"/><rect x="70" y="70" width="1060" height="620" rx="24" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.35)" stroke-width="3"/><text x="110" y="210" fill="#f4f8ff" font-size="62" font-family="Georgia, serif">${safeTitle}</text><text x="110" y="280" fill="#d7e4ff" font-size="32" font-family="Georgia, serif">${safeSubtitle}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function normalizeDocumentType(value: unknown): QuizDocument["type"] {
  const type = typeof value === "string" ? value : "";
  const allowed: QuizDocument["type"][] = [
    "memo",
    "newspaper",
    "image",
    "table",
    "spreadsheet",
    "transcript",
    "checklist",
  ];
  return allowed.includes(type as QuizDocument["type"]) ? (type as QuizDocument["type"]) : "memo";
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function normalizeTurnDocuments(bit: Record<string, unknown>, index: number): QuizDocument[] {
  const prompt = readString(bit.body)?.trim() || `Turn ${index + 1} prompt`;
  const extra = isRecord(bit.extraProperties) ? bit.extraProperties : null;
  const assets = Array.isArray(extra?.turnAssets) ? extra.turnAssets : [];

  const docs = assets
    .map((asset, docIndex) => {
      if (!isRecord(asset)) return null;

      const type = normalizeDocumentType(asset.type);
      const id = readString(asset.id)?.trim() || `turn-${index + 1}-doc-${docIndex + 1}`;
      const title = readString(asset.title)?.trim() || `Reference ${docIndex + 1}`;
      const width = readNumber(asset.width) && (readNumber(asset.width) ?? 0) > 0
        ? Math.round(readNumber(asset.width) as number)
        : type === "newspaper"
          ? 420
          : 350;
      const height = readNumber(asset.height) && (readNumber(asset.height) ?? 0) > 0
        ? Math.round(readNumber(asset.height) as number)
        : type === "newspaper"
          ? 330
          : 260;
      const persistent = asset.persistent === true;

      if (type === "memo") {
        return {
          id,
          title,
          type,
          width,
          height,
          persistent,
          content: readString(asset.content) || `Question focus:\n${prompt}`,
        } satisfies QuizDocument;
      }

      if (type === "newspaper") {
        return {
          id,
          title,
          type,
          width,
          height,
          persistent,
          headline: readString(asset.headline) || title,
          subhead: readString(asset.subhead) || "Generated context bulletin.",
          byline: readString(asset.byline) || "Desk Reporter",
          publishDate: readString(asset.publishDate) || "Generated",
          columns: normalizeStringArray(asset.columns),
        } satisfies QuizDocument;
      }

      if (type === "image") {
        const imagePrompt = readString(asset.imagePrompt) || prompt;
        return {
          id,
          title,
          type,
          width,
          height,
          persistent,
          imagePrompt,
          imageSrc: readString(asset.imageSrc) || buildImagePlaceholderDataUrl(title, imagePrompt),
        } satisfies QuizDocument;
      }

      if (type === "table" || type === "spreadsheet") {
        const table =
          isRecord(asset.table) &&
          Array.isArray(asset.table.columns) &&
          Array.isArray(asset.table.rows)
            ? {
                columns: asset.table.columns
                  .map((column) => (typeof column === "string" ? column : ""))
                  .filter((column) => column.length > 0),
                rows: asset.table.rows
                  .map((row) =>
                    Array.isArray(row) ? row.map((cell) => String(cell)) : []
                  )
                  .filter((row) => row.length > 0),
              }
            : {
                columns: ["Entry", "Value", "Status"],
                rows: [
                  ["Item 1", "Primary", "Verified"],
                  ["Item 2", "Secondary", "Pending"],
                ],
              };
        return {
          id,
          title,
          type,
          width,
          height,
          persistent,
          filePath: readString(asset.filePath) || undefined,
          table,
        } satisfies QuizDocument;
      }

      if (type === "transcript") {
        return {
          id,
          title,
          type,
          width,
          height,
          persistent,
          entries: normalizeStringArray(asset.entries),
        } satisfies QuizDocument;
      }

      return {
        id,
        title,
        type: "checklist",
        width,
        height,
        persistent,
        items: normalizeStringArray(asset.items),
      } satisfies QuizDocument;
    })
    .filter((doc) => doc !== null) as QuizDocument[];

  if (docs.length > 0) {
    return docs;
  }

  return [
    {
      id: `turn-${index + 1}-memo`,
      title: "Reference Memo",
      type: "memo",
      width: 360,
      height: 270,
      content: `Question focus:\n${prompt}`,
    },
  ];
}

function normalizeChoices(bits: Record<string, unknown>): { options: string[]; expected: string } {
  if (Array.isArray(bits.choices)) {
    const normalized = bits.choices
      .map((choice) => {
        if (!isRecord(choice)) return null;
        const text = readString(choice.choice)?.trim() ?? "";
        const isCorrect = choice.isCorrect === true;
        return text ? { text, isCorrect } : null;
      })
      .filter((choice): choice is { text: string; isCorrect: boolean } => choice !== null);

    if (normalized.length > 0) {
      const expected = normalized.find((choice) => choice.isCorrect)?.text ?? normalized[0].text;
      return { options: normalized.map((choice) => choice.text), expected };
    }
  }

  if (Array.isArray(bits.responses)) {
    const options = bits.responses
      .map((response) => {
        if (typeof response === "string") return response.trim();
        if (!isRecord(response)) return "";
        return (
          readString(response.response)?.trim() ??
          readString(response.text)?.trim() ??
          ""
        );
      })
      .filter((text) => text.length > 0);

    const solutions = Array.isArray(bits.solutions) ? bits.solutions : [];
    const expectedFromSolution = solutions.find((solution) => {
      if (!isRecord(solution)) return false;
      return typeof solution.response === "string";
    });
    const expected =
      (isRecord(expectedFromSolution) ? readString(expectedFromSolution.response) : null)?.trim() ??
      options[0] ??
      "Option A";

    return { options: options.length > 0 ? options : ["Option A", "Option B"], expected };
  }

  return { options: ["Option A", "Option B"], expected: "Option A" };
}

function normalizeTrueFalseExpected(bits: Record<string, unknown>): string {
  if (Array.isArray(bits.statements) && bits.statements.length > 0) {
    const first = bits.statements[0];
    if (isRecord(first)) {
      const value = readString(first.statement);
      if (value === "True") return "true";
      if (value === "False") return "false";
    }
  }
  return "true";
}

function normalizeSequenceValues(bits: Record<string, unknown>): string[] {
  if (!Array.isArray(bits.responses)) {
    return ["Step 1", "Step 2"];
  }

  const values = bits.responses
    .map((response) => {
      if (typeof response === "string") return response.trim();
      if (!isRecord(response)) return "";
      return (
        readString(response.response)?.trim() ??
        readString(response.text)?.trim() ??
        ""
      );
    })
    .filter((value) => value.length > 0);

  return values.length > 0 ? values : ["Step 1", "Step 2"];
}

function readMarks(bits: Record<string, unknown>): number {
  const direct = readNumber(bits.marks);
  if (direct !== null && direct > 0) {
    return Math.max(1, Math.round(direct));
  }

  if (isRecord(bits.extraProperties)) {
    const fromExtra = readNumber(bits.extraProperties.marks);
    if (fromExtra !== null && fromExtra > 0) {
      return Math.max(1, Math.round(fromExtra));
    }
  }

  return 1;
}

function readTurnNumber(bits: Record<string, unknown>, fallbackIndex: number): number {
  if (isRecord(bits.extraProperties)) {
    const turn = readNumber(bits.extraProperties.turn);
    if (turn !== null && turn >= 1) {
      return Math.max(1, Math.round(turn));
    }
  }

  return fallbackIndex + 1;
}

function readQuestionAssetRefs(
  bit: Record<string, unknown>,
  availableDocumentIds: string[]
): string[] | null {
  if (!isRecord(bit.extraProperties)) {
    return null;
  }

  if (!Object.prototype.hasOwnProperty.call(bit.extraProperties, "assetRefs")) {
    return null;
  }

  const rawRefs = bit.extraProperties.assetRefs;
  if (!Array.isArray(rawRefs)) {
    return [];
  }

  const seen = new Set<string>();
  return rawRefs
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0 && availableDocumentIds.includes(entry))
    .filter((entry) => {
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });
}

function mapSourceToolToRuntimeTool(value: unknown): QuizToolId | null {
  if (typeof value !== "string") return null;
  if (value === "calculator") return "calculator";
  if (value === "unit-converter") return "converter";
  if (value === "scratchpad") return "notepad";
  if (value === "text-highlighter") return "highlighter";
  return null;
}

function inferQuestionTools(
  bit: Record<string, unknown>,
  prompt: string,
  usesDocuments: string[]
): QuizToolId[] {
  const signalText = [
    prompt,
    readString(bit.instruction) ?? "",
    readString(bit.hint) ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const selected = new Set<QuizToolId>();

  if (/(calculate|compute|sum|count|avg|average|ratio|percent|difference|total|tax|cost|days|hours)/i.test(signalText)) {
    selected.add("calculator");
  }
  if (/(convert|unit|celsius|fahrenheit|kelvin|meter|km|mile|kg|lb|liter|gallon)/i.test(signalText)) {
    selected.add("converter");
  }
  if (
    /(sql|query|join|group by|dataset|table|spreadsheet|filter|sort|trend|analy[sz]e|compare)/i.test(signalText)
  ) {
    selected.add("calculator");
    selected.add("notepad");
  }
  if (usesDocuments.length > 0) {
    selected.add("highlighter");
    selected.add("eraser");
  }
  if (
    bit.type === "essay" ||
    bit.type === "question-1" ||
    bit.type === "sequence"
  ) {
    selected.add("notepad");
  }

  if (selected.size === 0) {
    selected.add("notepad");
  }

  return [...selected];
}

function readQuestionTools(
  bit: Record<string, unknown>,
  prompt: string,
  usesDocuments: string[]
): QuizToolId[] {
  const selected = new Set<QuizToolId>();

  if (isRecord(bit.extraProperties) && Array.isArray(bit.extraProperties.quizTools)) {
    for (const entry of bit.extraProperties.quizTools) {
      if (!isRecord(entry)) continue;
      const mapped = mapSourceToolToRuntimeTool(entry.tool);
      if (mapped) selected.add(mapped);
    }
  }

  for (const inferred of inferQuestionTools(bit, prompt, usesDocuments)) {
    selected.add(inferred);
  }

  if (selected.has("highlighter")) {
    selected.add("eraser");
  }

  return [...selected];
}

function bitToQuizQuestion(
  bit: Record<string, unknown>,
  index: number,
  usesDocuments: string[]
): QuizData["turns"][number]["questions"][number] {
  const id = readString(bit.id)?.trim() || `q${index + 1}`;
  const prompt =
    readString(bit.body)?.trim() ||
    readString(bit.item)?.trim() ||
    `Question ${index + 1}`;
  const marks = readMarks(bit);
  const tools = readQuestionTools(bit, prompt, usesDocuments);
  const type = normalizeBitType(bit.type);

  if (type === "multiple-choice") {
    const { options, expected } = normalizeChoices(bit);
    return {
      id,
      kind: "multiple-choice",
      prompt,
      marks,
      options,
      expected,
      usesDocuments,
      tools,
    };
  }

  if (type === "true-false" || type === "true-false-1") {
    return {
      id,
      kind: "true-false",
      prompt,
      marks,
      expected: normalizeTrueFalseExpected(bit),
      usesDocuments,
      tools,
    };
  }

  if (type === "sequence") {
    const expected = normalizeSequenceValues(bit);
    return {
      id,
      kind: "sequence",
      prompt,
      marks,
      sequencePool: rotateSequence(expected),
      expected,
      usesDocuments,
      tools,
    };
  }

  const ideal =
    readString(bit.sampleSolution)?.trim() ||
    (Array.isArray(bit.solutions)
      ? bit.solutions
          .map((solution) =>
            isRecord(solution) ? readString(solution.response)?.trim() ?? "" : ""
          )
          .find((value) => value.length > 0) ?? ""
      : "");

  return {
    id,
    kind: type === "essay" ? "essay" : "cloze",
    prompt,
    marks,
    expected: ideal,
    idealAnswer: ideal || undefined,
    usesDocuments,
    tools,
  };
}

function bitsToQuizData(bits: Record<string, unknown>[]): QuizData | null {
  if (bits.length === 0) return null;

  const bitsByTurn = new Map<number, Record<string, unknown>[]>();
  bits.forEach((bit, index) => {
    const turn = readTurnNumber(bit, index);
    const bucket = bitsByTurn.get(turn) ?? [];
    bucket.push(bit);
    bitsByTurn.set(turn, bucket);
  });

  const orderedTurns = Array.from(bitsByTurn.entries()).sort((a, b) => a[0] - b[0]);
  let runningQuestionIndex = 0;

  return {
    title: "Generated Quiz",
    turns: orderedTurns.map(([turnNumber, turnBits]) => {
      const documentMap = new Map<string, QuizDocument>();
      const fallbackDocRefsByQuestion = new Map<number, string[]>();

      turnBits.forEach((bit, questionIndex) => {
        const docs = normalizeTurnDocuments(bit, turnNumber - 1);
        const docIds: string[] = [];
        for (const doc of docs) {
          if (!documentMap.has(doc.id)) {
            documentMap.set(doc.id, doc);
          }
          docIds.push(doc.id);
        }
        fallbackDocRefsByQuestion.set(questionIndex, docIds);
      });

      const documents = Array.from(documentMap.values());
      const allDocumentIds = documents.map((doc) => doc.id);
      const questions = turnBits.map((bit, questionIndex) => {
        const explicitRefs = readQuestionAssetRefs(bit, allDocumentIds);
        const fallbackRefs = fallbackDocRefsByQuestion.get(questionIndex) ?? allDocumentIds;
        const refs = explicitRefs ?? fallbackRefs;
        const question = bitToQuizQuestion(bit, runningQuestionIndex, refs);
        runningQuestionIndex += 1;
        return question;
      });

      return {
        id: `turn-${turnNumber}`,
        label: `Turn ${turnNumber}`,
        briefing:
          questions.some((question) => Array.isArray(question.usesDocuments) && question.usesDocuments.length > 0)
            ? `Complete Turn ${turnNumber}. Use the reference items assigned to these questions.`
            : `Complete Turn ${turnNumber}.`,
        documents,
        questions,
      };
    }),
  };
}

function extractBitsFromUnknown(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!isRecord(entry)) return null;
      if (isRecord(entry.bit)) return entry.bit;
      return entry;
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);
}

function isValidQuestion(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.prompt !== "string") return false;
  if (typeof value.marks !== "number" || !Number.isFinite(value.marks) || value.marks < 0) return false;
  if (typeof value.kind !== "string" || !knownKinds.has(value.kind as QuestionKind)) return false;
  if (value.options !== undefined && !isStringArray(value.options)) return false;
  if (value.matchLeft !== undefined && !isStringArray(value.matchLeft)) return false;
  if (value.matchRight !== undefined && !isStringArray(value.matchRight)) return false;
  if (value.sequencePool !== undefined && !isStringArray(value.sequencePool)) return false;
  return true;
}

function isValidTurn(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.label !== "string") return false;
  if (typeof value.briefing !== "string") return false;
  if (!Array.isArray(value.documents)) return false;
  if (!Array.isArray(value.questions) || value.questions.length === 0) return false;
  return value.questions.every((question) => isValidQuestion(question));
}

export function isQuizData(value: unknown): value is QuizData {
  if (!isRecord(value)) return false;
  if (typeof value.title !== "string") return false;
  if (!Array.isArray(value.turns) || value.turns.length === 0) return false;
  return value.turns.every((turn) => isValidTurn(turn));
}

export function coerceQuizData(value: unknown): QuizData | null {
  if (isQuizData(value)) {
    return value;
  }

  if (isRecord(value)) {
    if (Array.isArray(value.quiz)) {
      return bitsToQuizData(extractBitsFromUnknown(value.quiz));
    }
    if (Array.isArray(value.bits)) {
      return bitsToQuizData(extractBitsFromUnknown(value.bits));
    }
  }

  return bitsToQuizData(extractBitsFromUnknown(value));
}

export function parseQuizDataJson(raw: string | null): QuizData | null {
  if (!raw) return null;
  try {
    return coerceQuizData(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function parseRuntimeQuizData(raw: string | null): QuizData | null {
  return parseQuizDataJson(raw);
}
