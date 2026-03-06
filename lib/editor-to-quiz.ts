import type { EditorQuestion, QuestionType, Turn } from "@/components/quizEditorTypes";
import type { QuizData, QuizDocument, QuizQuestion, QuizToolId } from "./quiz-types";

function mapTypeToKind(type: QuestionType): QuizQuestion["kind"] {
  if (type === "multiple-choice") return "multiple-choice";
  if (type === "true-false-1") return "true-false";
  if (type === "question-1") return "cloze";
  if (type === "essay") return "essay";
  return "sequence";
}

function rotateSequence(values: string[]): string[] {
  if (values.length <= 1) return values;
  return [...values.slice(1), values[0]];
}

function cleanText(value: string): string {
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
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

function readOptionTexts(question: EditorQuestion): string[] {
  return question.options
    .map((option) => cleanText(option.text))
    .filter((option) => option.length > 0);
}

function normalizeTable(
  value: unknown,
  fallbackRows: string[][]
): { columns: string[]; rows: string[][] } {
  if (isRecord(value) && Array.isArray(value.columns) && Array.isArray(value.rows)) {
    const columns = value.columns
      .map((column) => (typeof column === "string" ? column.trim() : ""))
      .filter((column) => column.length > 0);
    const rows = value.rows
      .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell)) : []))
      .filter((row) => row.length > 0);
    if (columns.length > 0 && rows.length > 0) {
      return { columns, rows };
    }
  }

  return {
    columns: ["Entry", "Value", "Status"],
    rows: fallbackRows,
  };
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

function buildFallbackDocuments(
  question: EditorQuestion,
  turnIndex: number,
  questionIndex: number
): QuizDocument[] {
  const prompt = cleanText(question.body) || `Turn ${turnIndex + 1} question`;
  const promptSnippet = prompt.slice(0, 110);
  const optionTexts = readOptionTexts(question);
  const rows =
    optionTexts.length > 0
      ? optionTexts.map((option, index) => [
          `Item ${index + 1}`,
          option,
          index % 2 === 0 ? "Verified" : "Pending",
        ])
      : [
          ["Item 1", "Primary signal", "Verified"],
          ["Item 2", "Secondary signal", "Pending"],
        ];

  const baseId = `t${turnIndex + 1}q${questionIndex + 1}`;
  const variant = turnIndex % 4;

  if (variant === 0) {
    return [
      {
        id: `${baseId}-newspaper`,
        title: "Daily Brief",
        type: "newspaper",
        width: 420,
        height: 340,
        headline: promptSnippet,
        subhead: "Use this bulletin to answer the question.",
        byline: "Operations Desk",
        publishDate: "Generated",
        columns: [
          `Context summary: ${promptSnippet}.`,
          "Cross-check the details before selecting your answer.",
        ],
      },
      {
        id: `${baseId}-memo`,
        title: "Supervisor Note",
        type: "memo",
        width: 360,
        height: 270,
        content: `Question focus:\n${promptSnippet}\n\nReminder:\nUse the provided context and avoid assumptions.`,
      },
    ];
  }

  if (variant === 1) {
    return [
      {
        id: `${baseId}-sheet`,
        title: "Turn Data Sheet",
        type: "spreadsheet",
        width: 390,
        height: 300,
        table: {
          columns: ["Entry", "Value", "Status"],
          rows,
        },
      },
      {
        id: `${baseId}-memo`,
        title: "Calculation Memo",
        type: "memo",
        width: 340,
        height: 250,
        content: "Review the sheet values and compare anomalies before answering.",
      },
    ];
  }

  if (variant === 2) {
    return [
      {
        id: `${baseId}-image`,
        title: "Evidence Image",
        type: "image",
        width: 340,
        height: 260,
        imageSrc: buildImagePlaceholderDataUrl("Evidence Board", promptSnippet),
        imagePrompt: promptSnippet,
      },
      {
        id: `${baseId}-transcript`,
        title: "Witness Transcript",
        type: "transcript",
        width: 390,
        height: 300,
        entries: [
          `Inspector: ${promptSnippet}`,
          "Analyst: Reviewing the attached evidence.",
          "Inspector: Confirm your conclusion with supporting details.",
        ],
      },
    ];
  }

  return [
    {
      id: `${baseId}-checklist`,
      title: "Procedure Checklist",
      type: "checklist",
      width: 360,
      height: 280,
      items: [
        "Read prompt carefully",
        "Cross-check evidence",
        "Eliminate invalid options",
        "Submit final answer",
      ],
    },
    {
      id: `${baseId}-table`,
      title: "Reference Table",
      type: "table",
      width: 340,
      height: 260,
      table: {
        columns: ["Entry", "Value", "Status"],
        rows,
      },
    },
  ];
}

function normalizeDocumentFromAsset(
  asset: unknown,
  question: EditorQuestion,
  turnIndex: number,
  questionIndex: number,
  docIndex: number
): QuizDocument | null {
  if (!isRecord(asset)) {
    return null;
  }

  const type = normalizeDocumentType(asset.type);
  const prompt = cleanText(question.body) || `Turn ${turnIndex + 1} reference`;
  const fallbackId = `t${turnIndex + 1}q${questionIndex + 1}d${docIndex + 1}`;
  const id = readText(asset.id, fallbackId) || fallbackId;
  const title = readText(asset.title, `Reference ${docIndex + 1}`) || `Reference ${docIndex + 1}`;
  const width = readPositiveNumber(asset.width, type === "newspaper" ? 420 : 350);
  const height = readPositiveNumber(asset.height, type === "newspaper" ? 330 : 260);
  const persistent = asset.persistent === true;

  if (type === "memo") {
    return {
      id,
      title,
      type,
      width,
      height,
      persistent,
      content: readText(asset.content, `Use this note to solve:\n${prompt}`),
    };
  }

  if (type === "newspaper") {
    const columns = toStringArray(asset.columns);
    return {
      id,
      title,
      type,
      width,
      height,
      persistent,
      headline: readText(asset.headline, title),
      subhead: readText(asset.subhead, "Generated news brief for this question."),
      byline: readText(asset.byline, "Desk Reporter"),
      publishDate: readText(asset.publishDate, "Generated"),
      columns:
        columns.length > 0
          ? columns
          : [`Context: ${prompt}`, "Review details and answer precisely."],
    };
  }

  if (type === "image") {
    const imagePrompt = readText(asset.imagePrompt, prompt);
    const imageSrc = readText(asset.imageSrc, "") || buildImagePlaceholderDataUrl(title, imagePrompt);
    return {
      id,
      title,
      type,
      width,
      height,
      persistent,
      imagePrompt,
      imageSrc,
    };
  }

  if (type === "table" || type === "spreadsheet") {
    const optionTexts = readOptionTexts(question);
    const fallbackRows =
      optionTexts.length > 0
        ? optionTexts.map((option, index) => [`Item ${index + 1}`, option, index % 2 === 0 ? "Yes" : "No"])
        : [
            ["Item 1", "Reference value", "Yes"],
            ["Item 2", "Comparison value", "No"],
          ];
    return {
      id,
      title,
      type,
      width,
      height,
      persistent,
      filePath: readText(asset.filePath, ""),
      table: normalizeTable(asset.table, fallbackRows),
    };
  }

  if (type === "transcript") {
    const entries = toStringArray(asset.entries);
    return {
      id,
      title,
      type,
      width,
      height,
      persistent,
      entries:
        entries.length > 0
          ? entries
          : [`Inspector: ${prompt}`, "Analyst: Reviewing all provided material."],
    };
  }

  if (type === "checklist") {
    const items = toStringArray(asset.items);
    return {
      id,
      title,
      type,
      width,
      height,
      persistent,
      items:
        items.length > 0
          ? items
          : ["Read prompt", "Inspect references", "Finalize answer"],
    };
  }

  return null;
}

function extractDocumentsForQuestion(
  question: EditorQuestion,
  turnIndex: number,
  questionIndex: number
): QuizDocument[] {
  const extraProperties =
    isRecord(question.sourceBit.extraProperties) ? question.sourceBit.extraProperties : null;
  const turnAssets = Array.isArray(extraProperties?.turnAssets)
    ? extraProperties?.turnAssets
    : [];

  const normalized = turnAssets
    .map((asset, index) =>
      normalizeDocumentFromAsset(asset, question, turnIndex, questionIndex, index)
    )
    .filter((asset): asset is QuizDocument => asset !== null);

  if (normalized.length > 0) {
    return normalized;
  }

  return buildFallbackDocuments(question, turnIndex, questionIndex);
}

function readMarks(sourceBit: Record<string, unknown>): number {
  const rawMarks = sourceBit.marks;
  if (typeof rawMarks === "number" && Number.isFinite(rawMarks) && rawMarks > 0) {
    return Math.max(1, Math.round(rawMarks));
  }

  const extraProperties = sourceBit.extraProperties;
  if (extraProperties && typeof extraProperties === "object" && !Array.isArray(extraProperties)) {
    const marksFromExtra = (extraProperties as Record<string, unknown>).marks;
    if (typeof marksFromExtra === "number" && Number.isFinite(marksFromExtra) && marksFromExtra > 0) {
      return Math.max(1, Math.round(marksFromExtra));
    }
  }

  return 1;
}

function readQuestionAssetRefs(
  question: EditorQuestion,
  availableDocumentIds: string[]
): string[] | null {
  const extraProperties =
    isRecord(question.sourceBit.extraProperties) ? question.sourceBit.extraProperties : null;

  if (!extraProperties || !Object.prototype.hasOwnProperty.call(extraProperties, "assetRefs")) {
    return null;
  }

  const rawRefs = (extraProperties as Record<string, unknown>).assetRefs;
  if (!Array.isArray(rawRefs)) {
    return [];
  }

  const seen = new Set<string>();
  const valid = rawRefs
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0 && availableDocumentIds.includes(entry))
    .filter((entry) => {
      if (seen.has(entry)) return false;
      seen.add(entry);
      return true;
    });

  return valid;
}

function mapSourceToolToRuntimeTool(value: unknown): QuizToolId | null {
  if (typeof value !== "string") return null;
  if (value === "calculator") return "calculator";
  if (value === "unit-converter") return "converter";
  if (value === "scratchpad") return "notepad";
  if (value === "text-highlighter") return "highlighter";
  return null;
}

function inferQuestionTools(question: EditorQuestion, usesDocuments: string[]): QuizToolId[] {
  const signalText = `${question.body} ${question.instruction}`.toLowerCase();
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
    question.type === "essay" ||
    question.type === "question-1" ||
    question.type === "sequence"
  ) {
    selected.add("notepad");
  }

  if (selected.size === 0) {
    selected.add("notepad");
  }

  return [...selected];
}

function readQuestionTools(question: EditorQuestion, usesDocuments: string[]): QuizToolId[] {
  const selected = new Set<QuizToolId>();
  const extraProperties =
    isRecord(question.sourceBit.extraProperties) ? question.sourceBit.extraProperties : null;

  if (extraProperties && Array.isArray(extraProperties.quizTools)) {
    for (const entry of extraProperties.quizTools) {
      if (!isRecord(entry)) continue;
      const mapped = mapSourceToolToRuntimeTool(entry.tool);
      if (mapped) selected.add(mapped);
    }
  }

  for (const inferred of inferQuestionTools(question, usesDocuments)) {
    selected.add(inferred);
  }

  if (selected.has("highlighter")) {
    selected.add("eraser");
  }

  return [...selected];
}

function toQuizQuestion(question: EditorQuestion, usesDocuments: string[]): QuizQuestion {
  const kind = mapTypeToKind(question.type);
  const prompt = cleanText(question.body) || "Untitled question";
  const marks = readMarks(question.sourceBit);
  const tools = readQuestionTools(question, usesDocuments);

  if (kind === "multiple-choice") {
    const cleanedOptions = question.options
      .map((option) => cleanText(option.text))
      .filter((option) => option.length > 0);
    const options = cleanedOptions.length >= 2 ? cleanedOptions : ["Option A", "Option B"];
    const expected =
      question.options.find((option) => option.isCorrect)?.text?.trim() ?? options[0] ?? "";

    return {
      id: question.id,
      kind,
      prompt,
      marks,
      options,
      expected,
      usesDocuments,
      tools,
    };
  }

  if (kind === "true-false") {
    const trueOption = question.options.find((option) => option.text.toLowerCase() === "true");
    const expected = trueOption?.isCorrect ? "true" : "false";
    return {
      id: question.id,
      kind,
      prompt,
      marks,
      expected,
      usesDocuments,
      tools,
    };
  }

  if (kind === "cloze") {
    const expected = cleanText(question.sampleSolution);
    return {
      id: question.id,
      kind,
      prompt,
      marks,
      expected,
      idealAnswer: expected || undefined,
      usesDocuments,
      tools,
    };
  }

  if (kind === "sequence") {
    const cleanedSteps = question.options
      .map((option) => cleanText(option.text))
      .filter((option) => option.length > 0);
    const expected = cleanedSteps.length > 0 ? cleanedSteps : ["Step 1", "Step 2"];

    return {
      id: question.id,
      kind,
      prompt,
      marks,
      sequencePool: rotateSequence(expected),
      expected,
      usesDocuments,
      tools,
    };
  }

  return {
    id: question.id,
    kind,
    prompt,
    marks,
    idealAnswer: cleanText(question.sampleSolution) || undefined,
    usesDocuments,
    tools,
  };
}

export function buildQuizDataFromEditorTurns(turns: Turn[]): QuizData {
  const normalizedTurns = turns
    .filter((turn) => turn.questions.length > 0)
    .map((turn, index) => {
      const documentMap = new Map<string, QuizDocument>();
      const questionDocumentIds = new Map<string, string[]>();

      turn.questions.forEach((question, questionIndex) => {
        const docs = extractDocumentsForQuestion(question, index, questionIndex);
        const docIds: string[] = [];
        for (const doc of docs) {
          if (!documentMap.has(doc.id)) {
            documentMap.set(doc.id, doc);
          }
          docIds.push(doc.id);
        }
        questionDocumentIds.set(question.id, docIds);
      });

      const documents = Array.from(documentMap.values());
      const allDocumentIds = documents.map((doc) => doc.id);
      const questions = turn.questions.map((question) => {
        const explicitRefs = readQuestionAssetRefs(question, allDocumentIds);
        const fallbackRefs = questionDocumentIds.get(question.id) ?? allDocumentIds;
        return toQuizQuestion(question, explicitRefs ?? fallbackRefs);
      });

      return {
        id: turn.id || `turn-${index + 1}`,
        label: turn.label || `Turn ${index + 1}`,
        briefing:
          documents.length > 0
            ? `Complete ${turn.label || `Turn ${index + 1}`}. Use the reference items on the desk.`
            : `Complete ${turn.label || `Turn ${index + 1}`}.`,
        documents,
        questions,
      };
    })
    .filter((turn) => turn.questions.length > 0);

  if (normalizedTurns.length === 0) {
    return {
      title: "Generated Quiz",
      turns: [
        {
          id: "turn-1",
          label: "Turn 1",
          briefing: "Complete Turn 1.",
          documents: [],
          questions: [
            {
              id: "q1",
              kind: "cloze",
              prompt: "Placeholder question",
              marks: 1,
              expected: "",
            },
          ],
        },
      ],
    };
  }

  return {
    title: "Generated Quiz",
    turns: normalizedTurns,
  };
}
