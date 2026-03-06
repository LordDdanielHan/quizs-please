import { NextRequest, NextResponse } from "next/server";
import { generateText, Output, jsonSchema } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  BitmarkParserGenerator,
  type BitWrapperJson,
} from "@gmb/bitmark-parser-generator";

type Difficulty = "easy" | "medium" | "hard";

type TurnPlanItem = {
  turn: number;
  difficulty: Difficulty;
  questionCount: number;
  questionIds: string[];
};

type TurnAsset = Record<string, unknown>;
type TurnAssetQuestionSnapshot = {
  prompt: string;
  options: string[];
};
type TurnAssetContext = {
  topic: string;
  turn: number;
  totalTurns: number;
  difficulty: Difficulty;
  questions: TurnAssetQuestionSnapshot[];
  focus: string;
  keywords: string[];
  previousFocus: string;
};

const QUESTION_COUNTS_BY_DIFFICULTY: Record<Difficulty, number> = {
  easy: 2,
  medium: 3,
  hard: 4,
};

const MARKS_BY_DIFFICULTY: Record<Difficulty, number> = {
  easy: 2,
  medium: 4,
  hard: 6,
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "against",
  "among",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "during",
  "each",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "may",
  "might",
  "more",
  "most",
  "must",
  "not",
  "of",
  "on",
  "one",
  "or",
  "our",
  "out",
  "over",
  "should",
  "so",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "under",
  "up",
  "use",
  "using",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "with",
  "would",
  "you",
  "your",
]);

const CASE_STAGES = [
  "baseline intake",
  "pilot rollout",
  "mid-cycle validation",
  "variance investigation",
  "control adjustment",
  "executive review",
];

const QUIZ_WRAPPER_OUTPUT_SCHEMA = jsonSchema<Record<string, unknown>>({
  type: "object",
  properties: {
    bit: {
      type: "object",
      properties: {
        type: { type: "string" },
        format: { type: "string" },
        id: { type: "string" },
        body: { type: "string" },
        instruction: { type: "string" },
        hint: { type: "string" },
        sampleSolution: { type: "string" },
        marks: { type: "number" },
        choices: {
          type: "array",
          items: {
            type: "object",
            properties: {
              choice: { type: "string" },
              isCorrect: { type: "boolean" },
            },
            required: ["choice", "isCorrect"],
            additionalProperties: false,
          },
        },
        responses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              response: { type: "string" },
              isCorrect: { type: "boolean" },
            },
            required: ["response", "isCorrect"],
            additionalProperties: false,
          },
        },
        statements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              statement: { type: "string" },
              isCorrect: { type: "boolean" },
            },
            required: ["statement", "isCorrect"],
            additionalProperties: false,
          },
        },
      },
      required: [
        "type",
        "format",
        "id",
        "body",
        "instruction",
        "hint",
        "sampleSolution",
        "marks",
        "choices",
        "responses",
        "statements",
      ],
      additionalProperties: false,
    },
  },
  required: ["bit"],
  additionalProperties: false,
});

function getDifficultyForTurn(turnIndex: number, totalTurns: number): Difficulty {
  const progress = turnIndex / totalTurns;

  if (progress <= 0.4) return "easy";
  if (progress <= 0.75) return "medium";
  return "hard";
}

function getQuestionCountForDifficulty(
  difficulty: Difficulty,
  totalTurns: number
): number {
  // Keep generation practical for large turn counts while preserving
  // "at least two per turn" and higher load for harder turns.
  if (totalTurns <= 10) {
    return QUESTION_COUNTS_BY_DIFFICULTY[difficulty];
  }

  if (difficulty === "easy") return 2;
  if (difficulty === "medium") return 2;
  return 3;
}

function buildTurnPlan(turns: number): TurnPlanItem[] {
  const plan: TurnPlanItem[] = [];
  let nextQuestionNumber = 1;

  for (let turn = 1; turn <= turns; turn += 1) {
    const difficulty = getDifficultyForTurn(turn, turns);
    const questionCount = getQuestionCountForDifficulty(difficulty, turns);
    const questionIds = Array.from({ length: questionCount }, () => `q${nextQuestionNumber++}`);
    plan.push({ turn, difficulty, questionCount, questionIds });
  }

  return plan;
}

function isReasoningModel(modelId: string): boolean {
  const normalized = modelId.trim().toLowerCase();
  return (
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4")
  );
}

function buildGenerationSettings(
  modelId: string,
  maxOutputTokens: number,
  temperature: number
): {
  maxOutputTokens: number;
  temperature?: number;
  providerOptions?: { openai: { reasoningEffort: "minimal" } };
} {
  if (isReasoningModel(modelId)) {
    return {
      maxOutputTokens,
      providerOptions: {
        openai: {
          reasoningEffort: "minimal",
        },
      },
    };
  }

  return {
    maxOutputTokens,
    temperature,
  };
}

async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  run: (abortSignal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`${label} timed out`), timeoutMs);

  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function escapeSvg(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildInlineImageDataUrl(title: string, subtitle: string): string {
  const safeTitle = escapeSvg(title || "Reference");
  const safeSubtitle = escapeSvg(subtitle || "Generated visual aid");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#2b3447"/><stop offset="100%" stop-color="#576c8f"/></linearGradient></defs><rect width="1200" height="760" fill="url(#bg)"/><rect x="70" y="70" width="1060" height="620" rx="24" fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.35)" stroke-width="3"/><text x="110" y="210" fill="#f4f8ff" font-size="62" font-family="Georgia, serif">${safeTitle}</text><text x="110" y="285" fill="#d7e4ff" font-size="32" font-family="Georgia, serif">${safeSubtitle}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function readChoiceTexts(bit: Record<string, unknown>): string[] {
  if (Array.isArray(bit.choices)) {
    return bit.choices
      .map((choice) =>
        typeof choice === "object" &&
        choice !== null &&
        "choice" in choice &&
        typeof (choice as { choice?: unknown }).choice === "string"
          ? (choice as { choice: string }).choice.trim()
          : ""
      )
      .filter((choice) => choice.length > 0);
  }

  if (Array.isArray(bit.responses)) {
    return bit.responses
      .map((response) => {
        if (typeof response === "string") return response.trim();
        if (!response || typeof response !== "object") return "";
        if (typeof (response as { response?: unknown }).response === "string") {
          return ((response as { response: string }).response ?? "").trim();
        }
        return "";
      })
      .filter((entry) => entry.length > 0);
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function summarizePrompt(value: string): string {
  const normalized = normalizeWhitespace(value).replace(/[?!.]+$/g, "");
  const withoutLead = normalized.replace(
    /^(what|which|how|why|when|where|explain|describe|identify|choose|select)\b\s*/i,
    ""
  );
  return withoutLead.slice(0, 140) || normalized.slice(0, 140);
}

function toHeadlineCase(value: string): string {
  return value
    .split(/[\s/-]+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function extractKeywords(text: string, maxCount = 7): string[] {
  const tokens = normalizeWhitespace(text)
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g);

  if (!tokens) return [];

  const counts = new Map<string, number>();

  for (const token of tokens) {
    if (STOP_WORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxCount)
    .map(([token]) => token);
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function pseudoRandom(seed: number, offset: number): number {
  const value = Math.sin(seed * 0.017 + offset * 19.19) * 10000;
  return value - Math.floor(value);
}

function randomBetween(seed: number, offset: number, min: number, max: number): number {
  return min + (max - min) * pseudoRandom(seed, offset);
}

function getAssetRowCount(difficulty: Difficulty): number {
  if (difficulty === "easy") return 6;
  if (difficulty === "medium") return 8;
  return 10;
}

function readTurnNumberFromExtras(extra: Record<string, unknown>): number {
  if (typeof extra.turn === "number" && Number.isFinite(extra.turn)) {
    return Math.max(1, Math.round(extra.turn));
  }
  return 1;
}

function readDifficultyFromExtras(extra: Record<string, unknown>): Difficulty {
  if (extra.difficulty === "easy" || extra.difficulty === "medium" || extra.difficulty === "hard") {
    return extra.difficulty;
  }
  return "medium";
}

function buildTurnSheet(context: TurnAssetContext): {
  title: string;
  columns: string[];
  rows: string[][];
  summary: string[];
} {
  const combinedContext = `${context.topic} ${context.focus} ${context.keywords.join(" ")}`.toLowerCase();
  const isSqlTrack = /(sql|database|query|join|table|schema|index|select|where|group by|postgres|mysql|sqlite)/.test(
    combinedContext
  );
  const isComplianceTrack = /(tax|compliance|audit|filing|lhdn|sst|invoice|account|finance|malaysia)/.test(
    combinedContext
  );
  const rowCount = getAssetRowCount(context.difficulty);
  const seed = stableHash(`${context.topic}|${context.focus}|${context.turn}|${context.difficulty}`);

  if (isSqlTrack) {
    const regions = ["APAC", "EMEA", "NA", "LATAM"];
    const tiers = ["Enterprise", "Mid-Market", "SMB"];
    const rows: string[][] = [];
    let highValueRows = 0;
    let lateRows = 0;

    for (let index = 0; index < rowCount; index += 1) {
      const customerId = 1000 + context.turn * 100 + index;
      const region = regions[(index + context.turn) % regions.length];
      const tier = tiers[(index + context.turn) % tiers.length];
      const orders = Math.round(randomBetween(seed, index + 1, 2, 18));
      const avgOrder = randomBetween(seed, index + 11, 120, 1150);
      const totalSpend = orders * avgOrder;
      const daysLate = Math.round(randomBetween(seed, index + 21, 0, 22));
      const discountPct = Math.round(randomBetween(seed, index + 31, 0, 28));
      const riskScore = Math.round(randomBetween(seed, index + 41, 34, 97));
      const paymentStatus = daysLate > 10 ? "Late" : "On-time";

      if (totalSpend >= 7000) highValueRows += 1;
      if (paymentStatus === "Late") lateRows += 1;

      rows.push([
        String(customerId),
        region,
        tier,
        String(orders),
        avgOrder.toFixed(0),
        totalSpend.toFixed(0),
        String(discountPct),
        String(daysLate),
        String(riskScore),
        paymentStatus,
      ]);
    }

    return {
      title: "Customer Orders Dataset",
      columns: [
        "customer_id",
        "region",
        "tier",
        "orders_count",
        "avg_order_value",
        "total_spend",
        "discount_pct",
        "days_late",
        "risk_score",
        "payment_status",
      ],
      rows,
      summary: [
        `${highValueRows}/${rowCount} rows are high-value accounts by total_spend.`,
        `${lateRows}/${rowCount} rows have payment_status=Late and may affect filtering logic.`,
      ],
    };
  }

  if (isComplianceTrack) {
    const tasks = [
      "Invoice classification",
      "SST tagging",
      "Withholding tax checks",
      "e-Invoice validation",
      "GL reconciliation",
      "Exception routing",
      "LHDN filing pack",
      "Payment matching",
      "Vendor KYC refresh",
      "Audit trail review",
      "Cross-border coding",
      "Late fee prevention",
    ];

    let improvedCount = 0;
    let elevatedRiskCount = 0;
    const rows: string[][] = [];

    for (let index = 0; index < rowCount; index += 1) {
      const task = tasks[(index + context.turn) % tasks.length];
      const volume = Math.round(randomBetween(seed, index + 1, 85, 260));
      const manualHours = randomBetween(seed, index + 11, 5.4, 13.2);
      let aiHours = manualHours * randomBetween(seed, index + 21, 0.43, 0.74);
      const manualError = randomBetween(seed, index + 31, 2.4, 9.8);
      let aiError = Math.max(0.6, manualError - randomBetween(seed, index + 41, 1.1, 4.2));

      if (context.difficulty === "hard" && index % 4 === 0) {
        aiHours += randomBetween(seed, index + 51, 0.5, 1.2);
        aiError += randomBetween(seed, index + 61, 0.4, 1.0);
      }

      if (aiHours < manualHours && aiError < manualError) {
        improvedCount += 1;
      }

      const penaltyExposure = Math.round(volume * aiError * 12);
      if (penaltyExposure > 3200) {
        elevatedRiskCount += 1;
      }

      rows.push([
        task,
        String(volume),
        manualHours.toFixed(1),
        aiHours.toFixed(1),
        `${manualError.toFixed(1)}%`,
        `${aiError.toFixed(1)}%`,
        `RM ${penaltyExposure.toLocaleString("en-US")}`,
        penaltyExposure > 3200 ? "Escalate" : "Monitor",
      ]);
    }

    return {
      title: "Tax Compliance Operations Sheet",
      columns: [
        "Workflow Step",
        "Monthly Cases",
        "Manual Time (h)",
        "AI Time (h)",
        "Manual Error %",
        "AI Error %",
        "Penalty Exposure",
        "Flag",
      ],
      rows,
      summary: [
        `AI outperformed manual handling in ${improvedCount}/${rowCount} workflows this turn.`,
        `${elevatedRiskCount} workflows still show elevated penalty exposure and need controls.`,
      ],
    };
  }

  const stages = [
    "Intake triage",
    "Record cleanup",
    "Validation pass",
    "Exception handling",
    "Reporting prep",
    "Stakeholder review",
    "Closure checks",
    "Feedback loop",
    "Policy update",
    "Root-cause audit",
  ];
  const rows: string[][] = [];
  let improvedCount = 0;

  for (let index = 0; index < rowCount; index += 1) {
    const stage = stages[(index + context.turn) % stages.length];
    const volume = Math.round(randomBetween(seed, index + 71, 70, 240));
    const manualCycle = randomBetween(seed, index + 81, 4.1, 11.4);
    let aiCycle = manualCycle * randomBetween(seed, index + 91, 0.48, 0.78);
    if (context.difficulty === "hard" && index % 5 === 0) {
      aiCycle += randomBetween(seed, index + 101, 0.3, 0.8);
    }
    const confidence = randomBetween(seed, index + 111, 71, 96);
    const variance = ((manualCycle - aiCycle) / manualCycle) * 100;
    if (variance > 0) improvedCount += 1;

    rows.push([
      stage,
      String(volume),
      manualCycle.toFixed(1),
      aiCycle.toFixed(1),
      `${variance.toFixed(1)}%`,
      `${confidence.toFixed(1)}%`,
      confidence < 80 ? "Review" : "Stable",
    ]);
  }

  return {
    title: "Operational Performance Sheet",
    columns: [
      "Workflow Step",
      "Weekly Volume",
      "Manual Cycle (h)",
      "AI Cycle (h)",
      "Variance Gain",
      "Confidence",
      "Status",
    ],
    rows,
    summary: [
      `Cycle-time gains appear in ${improvedCount}/${rowCount} workflow stages.`,
      "Low-confidence rows are intended as review points, not direct conclusions.",
    ],
  };
}

function buildTurnFocus(topic: string, questions: TurnAssetQuestionSnapshot[], turn: number): {
  focus: string;
  keywords: string[];
} {
  const promptText = questions
    .map((question) => summarizePrompt(question.prompt))
    .filter((entry) => entry.length > 0)
    .join(" ");
  const optionText = questions
    .flatMap((question) => question.options)
    .map((entry) => normalizeWhitespace(entry))
    .filter((entry) => entry.length > 0)
    .join(" ");
  const keywordPool = extractKeywords(`${topic} ${promptText} ${optionText}`);
  const focus =
    keywordPool.slice(0, 4).map(toHeadlineCase).join(" / ") ||
    summarizePrompt(questions[0]?.prompt || `Turn ${turn} scenario`);

  return { focus, keywords: keywordPool };
}

function buildHintMemo(
  context: TurnAssetContext,
  sheetSummary: string[]
): string {
  const stageLabel =
    CASE_STAGES[Math.min(context.turn - 1, CASE_STAGES.length - 1)] ?? "analysis";
  const carryLine =
    context.turn > 1
      ? `Carry-over from Turn ${context.turn - 1}: ${context.previousFocus || "review previous findings"}.`
      : "Starting point: establish a baseline before selecting an answer.";

  if (context.difficulty === "easy") {
    return [
      `Turn ${context.turn} Analyst Memo`,
      "",
      `Stage: ${stageLabel}.`,
      carryLine,
      "",
      "How to use the evidence:",
      "1) Compare manual vs AI columns row-by-row.",
      "2) Verify whether the same pattern appears in most rows.",
      "3) Use the repeated pattern, not a single outlier, to answer.",
      "",
      `Signal summary: ${sheetSummary.join(" ")}`,
    ].join("\n");
  }

  if (context.difficulty === "medium") {
    return [
      `Turn ${context.turn} Review Note`,
      "",
      `Stage: ${stageLabel}.`,
      carryLine,
      "",
      "Guidance:",
      "- Identify where gains are consistent and where they are fragile.",
      "- Prioritize rows marked for review before drawing conclusions.",
      "- Explain your answer using at least two pieces of evidence.",
      "",
      `Signal summary: ${sheetSummary.join(" ")}`,
    ].join("\n");
  }

  return [
    `Turn ${context.turn} Strategy Note`,
    "",
    `Stage: ${stageLabel}.`,
    carryLine,
    "",
    "Guidance:",
    "- This turn includes mixed signals by design.",
    "- Balance efficiency improvements against remaining risk.",
    "- Give a justified conclusion, not a one-sided claim.",
    "",
    `Signal summary: ${sheetSummary.join(" ")}`,
  ].join("\n");
}

function buildTurnTranscript(
  context: TurnAssetContext,
  summary: string[]
): string[] {
  const stageLabel =
    CASE_STAGES[Math.min(context.turn - 1, CASE_STAGES.length - 1)] ?? "analysis";
  const carryLine =
    context.turn > 1
      ? `We are continuing from Turn ${context.turn - 1}, where "${context.previousFocus}" was the main thread.`
      : "This is the first briefing in the case sequence.";

  return [
    `Lead Analyst: Stage update is ${stageLabel}.`,
    `Ops Manager: ${carryLine}`,
    `Audit Officer: ${summary[0] ?? "Review cross-row evidence before deciding."}`,
    "Data Engineer: Outliers are intentional, validate the dominant pattern.",
    "Lead Analyst: Final response must be evidence-backed, not assumption-backed.",
  ];
}

function hasSelfContainedSchemaSnippet(text: string): boolean {
  return /\btable\s+[a-z_][a-z0-9_]*\s*\(\s*[a-z_][a-z0-9_]*(\s*,\s*[a-z_][a-z0-9_]*)+\s*\)/i.test(
    text
  );
}

function hasExplicitExternalEvidenceCue(text: string): boolean {
  return /(according to|based on|from|using|use|refer to|inspect|look at)\s+(the\s+)?(table|dataset|sheet|spreadsheet|memo|brief|report|bulletin|transcript|newspaper|image|diagram|figure|photo|map|screenshot|chart)/i.test(
    text
  );
}

function questionNeedsDataAsset(text: string): boolean {
  const normalized = text.toLowerCase();
  if (hasExplicitExternalEvidenceCue(normalized)) {
    return /(table|dataset|sheet|spreadsheet|data|rows?|records?|entries?|values?)/i.test(normalized);
  }

  // "You are given table_x(col1, col2)" is a schema prompt, usually self-contained.
  if (hasSelfContainedSchemaSnippet(normalized)) {
    return false;
  }

  const hasQuantIntent = /(calculate|compute|sum|count|average|avg|median|percent|percentage|ratio|difference|highest|lowest|max|min|total|trend|compare|rank|sort|filter|group by|aggregate)/i.test(
    normalized
  );
  const hasRowDataCue = /(dataset|spreadsheet|sheet|table data|rows?|records?|entries?|values?|sample data|provided data)/i.test(
    normalized
  );
  return hasQuantIntent && hasRowDataCue;
}

function questionNeedsCaseNarrative(text: string): boolean {
  const normalized = text.toLowerCase();
  if (hasExplicitExternalEvidenceCue(normalized)) {
    return /(memo|brief|report|bulletin|newspaper|transcript|incident|policy note|case file)/i.test(
      normalized
    );
  }

  return /(case brief|policy memo|incident report|news bulletin|witness transcript|case file)/i.test(
    normalized
  );
}

function questionNeedsImageAsset(text: string): boolean {
  const normalized = text.toLowerCase();
  if (hasExplicitExternalEvidenceCue(normalized)) {
    return /(image|diagram|figure|visual|photo|map|screenshot|chart)/i.test(normalized);
  }

  return /(image below|diagram below|figure below|see the image|inspect the diagram)/i.test(
    normalized
  );
}

function buildTurnQuestionSignal(questions: TurnAssetQuestionSnapshot[]): string {
  return questions
    .map((question) => `${question.prompt} ${question.options.join(" ")}`)
    .join(" ")
    .trim();
}

function turnRequiresAssets(questions: TurnAssetQuestionSnapshot[]): boolean {
  const signal = buildTurnQuestionSignal(questions);
  return (
    questionNeedsDataAsset(signal) ||
    questionNeedsCaseNarrative(signal) ||
    questionNeedsImageAsset(signal)
  );
}

function buildFallbackTurnAssets(context: TurnAssetContext): TurnAsset[] {
  const sheet = buildTurnSheet(context);
  const stageLabel =
    CASE_STAGES[Math.min(context.turn - 1, CASE_STAGES.length - 1)] ?? "analysis";
  const prefix = `turn-${context.turn}`;
  const caseTitle = toHeadlineCase(context.topic).slice(0, 48) || "Operational Case";
  const carryText =
    context.turn > 1
      ? `This turn extends the case from Turn ${context.turn - 1}, especially around ${context.previousFocus}.`
      : "This is the opening turn for the case dossier.";

  const newspaperColumns = [
    `Case focus: ${context.focus}. Stage: ${stageLabel}. Progress: turn ${context.turn} of ${context.totalTurns}. ${carryText}`,
    `Evidence digest: ${sheet.summary[0]}`,
    `Control note: ${sheet.summary[1]}`,
  ];

  const questionText = buildTurnQuestionSignal(context.questions);
  const needsData = questionNeedsDataAsset(questionText);
  const needsCase = questionNeedsCaseNarrative(questionText);
  const needsImage = questionNeedsImageAsset(questionText);

  const assets: TurnAsset[] = [];

  if (needsData) {
    assets.push({
      id: `${prefix}-sheet`,
      title: sheet.title,
      type: "spreadsheet",
      width: 470,
      height: 330,
      table: {
        columns: sheet.columns,
        rows: sheet.rows,
      },
    });
  }

  if (needsCase) {
    assets.push({
      id: `${prefix}-brief`,
      title: "Casewire Bulletin",
      type: "newspaper",
      width: 430,
      height: 340,
      headline: `${caseTitle} - Turn ${context.turn} Briefing`,
      subhead: "Use this briefing together with the referenced evidence.",
      byline: "Scenario Desk",
      publishDate: `Turn ${context.turn}/${context.totalTurns} / Generated`,
      columns: newspaperColumns,
    });
  }

  if (needsImage) {
    assets.push({
      id: `${prefix}-image`,
      title: "Visual Evidence",
      type: "image",
      width: 350,
      height: 260,
      imageSrc: buildInlineImageDataUrl(`${caseTitle} T${context.turn}`, context.focus),
      imagePrompt: `${context.focus}. ${stageLabel}.`,
    });
  }

  if (needsCase && context.difficulty === "medium") {
    assets.push({
      id: `${prefix}-transcript`,
      title: "Operations Transcript",
      type: "transcript",
      width: 420,
      height: 300,
      entries: buildTurnTranscript(context, sheet.summary),
    });
  } else if (needsCase) {
    assets.push({
      id: `${prefix}-memo`,
      title: context.difficulty === "hard" ? "Supervisor Strategy Memo" : "Supervisor Memo",
      type: "memo",
      width: 390,
      height: 290,
      content: buildHintMemo(context, sheet.summary),
    });
  }

  return assets;
}

function cloneTurnAssets(assets: TurnAsset[]): TurnAsset[] {
  return JSON.parse(JSON.stringify(assets)) as TurnAsset[];
}

function hasSufficientTurnAssets(assets: unknown[], difficulty: Difficulty): boolean {
  if (assets.length === 0) return false;

  const minRows = difficulty === "easy" ? 5 : difficulty === "medium" ? 7 : 9;
  let hasUsableAsset = false;

  for (const asset of assets) {
    if (!isRecord(asset)) continue;

    if ((asset.type === "table" || asset.type === "spreadsheet") && isRecord(asset.table)) {
      const rows = Array.isArray(asset.table.rows) ? asset.table.rows : [];
      if (rows.length >= minRows) {
        hasUsableAsset = true;
      }
    }

    if (asset.type === "image") {
      const imageSrc = typeof asset.imageSrc === "string" ? asset.imageSrc.trim() : "";
      const imagePrompt = typeof asset.imagePrompt === "string" ? asset.imagePrompt.trim() : "";
      if (imageSrc.length > 0 || imagePrompt.length > 0) {
        hasUsableAsset = true;
      }
    }

    if (typeof asset.content === "string" && asset.content.trim().length >= 80) {
      hasUsableAsset = true;
    }

    if (Array.isArray(asset.columns)) {
      const text = asset.columns
        .filter((entry) => typeof entry === "string")
        .join(" ");
      if (text.length >= 80) {
        hasUsableAsset = true;
      }
    }

    if (Array.isArray(asset.entries)) {
      const text = asset.entries
        .filter((entry) => typeof entry === "string")
        .join(" ");
      if (text.length >= 80) {
        hasUsableAsset = true;
      }
    }

    if (Array.isArray(asset.items)) {
      const text = asset.items
        .filter((entry) => typeof entry === "string")
        .join(" ");
      if (text.length >= 80) {
        hasUsableAsset = true;
      }
    }
  }

  return hasUsableAsset;
}

type AssetDescriptor = {
  id: string;
  type: string;
  title: string;
};

function extractAssetDescriptors(assets: unknown[]): AssetDescriptor[] {
  const descriptors: AssetDescriptor[] = [];
  const seen = new Set<string>();

  for (const asset of assets) {
    if (!isRecord(asset) || typeof asset.id !== "string") continue;
    const id = asset.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    descriptors.push({
      id,
      type: typeof asset.type === "string" ? asset.type.trim().toLowerCase() : "",
      title: typeof asset.title === "string" ? asset.title.trim() : id,
    });
  }

  return descriptors;
}

function scoreAssetForQuestion(asset: AssetDescriptor, signalText: string): number {
  const text = signalText.toLowerCase();
  const type = asset.type;
  let score = 0;

  if (type === "spreadsheet" || type === "table") score += 6;
  if (type === "memo" || type === "transcript" || type === "checklist") score += 4;
  if (type === "newspaper") score += 2;
  if (type === "image") score += 1;

  if (
    /(sql|query|join|group|aggregate|table|spreadsheet|dataset|calculate|compute|sum|count|avg|average|filter|sort|trend|chart)/i.test(
      text
    )
  ) {
    if (type === "spreadsheet" || type === "table") score += 12;
    if (type === "memo" || type === "transcript") score += 2;
  }

  if (/(news|brief|policy|case|report|memo|stakeholder|decision)/i.test(text)) {
    if (type === "newspaper") score += 10;
    if (type === "memo" || type === "transcript") score += 5;
  }

  if (/(image|diagram|visual|photo|figure|screenshot)/i.test(text)) {
    if (type === "image") score += 12;
  }

  return score;
}

function chooseDocumentRefs(
  assets: AssetDescriptor[],
  signalText: string,
  seed: number,
  count: number
): string[] {
  if (assets.length === 0 || count <= 0) return [];

  const ranked = assets
    .map((asset, index) => ({
      asset,
      score: scoreAssetForQuestion(asset, signalText) + (seed % (index + 7)),
    }))
    .sort((a, b) => b.score - a.score);

  return ranked.slice(0, Math.min(count, ranked.length)).map((entry) => entry.asset.id);
}

function questionExplicitlyNeedsEvidence(text: string): boolean {
  const normalized = text.toLowerCase();
  if (hasExplicitExternalEvidenceCue(normalized)) return true;
  return /(table below|dataset below|provided spreadsheet|provided memo|provided report|evidence provided|use the reference)/i.test(
    normalized
  );
}

function ensureQuestionAssetRefs(normalized: BitWrapperJson[]): void {
  const wrappersByTurn = new Map<number, BitWrapperJson[]>();

  for (const wrapper of normalized) {
    const bit = wrapper.bit as { extraProperties?: unknown };
    const extras = isRecord(bit.extraProperties) ? bit.extraProperties : {};
    const turn = readTurnNumberFromExtras(extras);
    const bucket = wrappersByTurn.get(turn) ?? [];
    bucket.push(wrapper);
    wrappersByTurn.set(turn, bucket);
  }

  for (const wrappers of wrappersByTurn.values()) {
    if (wrappers.length === 0) continue;

    const firstBit = wrappers[0].bit as { extraProperties?: unknown };
    const firstExtras = isRecord(firstBit.extraProperties) ? firstBit.extraProperties : {};
    const difficulty = readDifficultyFromExtras(firstExtras);
    const turnAssets = Array.isArray(firstExtras.turnAssets) ? firstExtras.turnAssets : [];
    const availableAssets = extractAssetDescriptors(turnAssets);
    const availableAssetIds = availableAssets.map((asset) => asset.id);
    const assetTitleById = Object.fromEntries(
      availableAssets.map((asset) => [asset.id, asset.title || asset.id])
    ) as Record<string, string>;

    const entries = wrappers.map((wrapper, index) => {
      const bit = wrapper.bit as {
        id?: unknown;
        body?: unknown;
        instruction?: unknown;
      };
      const body = typeof bit.body === "string" ? bit.body : "";
      const instruction = typeof bit.instruction === "string" ? bit.instruction : "";
      const signalText = `${body} ${instruction}`.trim();
      const score = stableHash(`${bit.id ?? ""}|${signalText}|${index}`);
      return {
        wrapper,
        signalText,
        explicitNeed: questionExplicitlyNeedsEvidence(signalText),
        inferredNeed:
          questionNeedsDataAsset(signalText) ||
          questionNeedsCaseNarrative(signalText) ||
          questionNeedsImageAsset(signalText),
        score,
      };
    });

    entries.forEach((entry, index) => {
      const bit = entry.wrapper.bit as { extraProperties?: unknown };
      const extras = isRecord(bit.extraProperties) ? bit.extraProperties : {};
      const selected =
        availableAssetIds.length > 0 && (entry.explicitNeed || entry.inferredNeed);

      let refs: string[] = [];
      if (selected) {
        const wantsMultiple =
          availableAssetIds.length >= 2 &&
          (
            (difficulty === "hard" && (entry.explicitNeed || entry.score % 3 !== 0)) ||
            (difficulty === "medium" && /compare|trade|balance|justify|synthesize|evaluate/i.test(entry.signalText))
          );
        const desiredCount = wantsMultiple ? 2 : 1;
        refs = chooseDocumentRefs(availableAssets, entry.signalText, entry.score, desiredCount);
      }

      extras.assetRefs = refs;
      extras.requiresEvidence = refs.length > 0;
      if (refs.length > 0) {
        const bitWithPrompt = bit as { instruction?: unknown; hint?: unknown };
        const existingInstruction =
          typeof bitWithPrompt.instruction === "string" ? bitWithPrompt.instruction.trim() : "";
        const shouldInjectEvidenceCue =
          !questionExplicitlyNeedsEvidence(entry.signalText) &&
          !/use|refer|based on|according to/i.test(existingInstruction);

        if (shouldInjectEvidenceCue) {
          const labels = refs.map((ref) => assetTitleById[ref] ?? ref).join(", ");
          bitWithPrompt.instruction = existingInstruction
            ? `${existingInstruction} Use these references: ${labels}.`
            : `Use these references: ${labels}.`;
        }
      }
      bit.extraProperties = extras;
    });
  }
}

function ensureTurnAssets(
  normalized: BitWrapperJson[],
  topic: string,
  turnPlan: TurnPlanItem[]
): void {
  const byTurn = new Map<
    number,
    {
      difficulty: Difficulty;
      questions: TurnAssetQuestionSnapshot[];
    }
  >();
  const wrappersByTurn = new Map<number, BitWrapperJson[]>();

  for (const wrapper of normalized) {
    const bit = wrapper.bit as {
      body?: unknown;
      extraProperties?: {
        turn?: unknown;
        difficulty?: unknown;
        turnAssets?: unknown;
      };
    };

    if (!bit.extraProperties || typeof bit.extraProperties !== "object") {
      bit.extraProperties = {};
    }

    const extras = bit.extraProperties as Record<string, unknown>;
    const turn = readTurnNumberFromExtras(extras);
    const difficulty = readDifficultyFromExtras(extras);
    const bucket = byTurn.get(turn) ?? { difficulty, questions: [] };

    bucket.difficulty = difficulty;
    bucket.questions.push({
      prompt: typeof bit.body === "string" ? bit.body : "",
      options: readChoiceTexts(bit as Record<string, unknown>),
    });
    byTurn.set(turn, bucket);

    const turnWrappers = wrappersByTurn.get(turn) ?? [];
    turnWrappers.push(wrapper);
    wrappersByTurn.set(turn, turnWrappers);
  }

  const totalTurns =
    turnPlan.length > 0
      ? turnPlan.length
      : Math.max(...Array.from(byTurn.keys()), 1);
  const turnOrder = Array.from(byTurn.keys()).sort((a, b) => a - b);
  const generatedByTurn = new Map<number, TurnAsset[]>();
  let previousFocus = "";

  for (const turn of turnOrder) {
    const bucket = byTurn.get(turn);
    if (!bucket) continue;
    const { focus, keywords } = buildTurnFocus(topic, bucket.questions, turn);

    const context: TurnAssetContext = {
      topic,
      turn,
      totalTurns,
      difficulty: bucket.difficulty,
      questions: bucket.questions,
      focus,
      keywords,
      previousFocus,
    };

    generatedByTurn.set(
      turn,
      turnRequiresAssets(bucket.questions) ? buildFallbackTurnAssets(context) : []
    );
    previousFocus = focus;
  }

  for (const [turn, wrappers] of wrappersByTurn.entries()) {
    const turnMeta = byTurn.get(turn);
    const difficulty = turnMeta?.difficulty ?? "medium";
    const requiresAssets = turnMeta ? turnRequiresAssets(turnMeta.questions) : false;
    const generatedAssets = generatedByTurn.get(turn) ?? [];

    let canonicalAssets: unknown[] | null = null;
    if (requiresAssets) {
      for (const wrapper of wrappers) {
        const bit = wrapper.bit as { extraProperties?: unknown };
        const extras = isRecord(bit.extraProperties) ? bit.extraProperties : {};
        const providedAssets = Array.isArray(extras.turnAssets) ? extras.turnAssets : [];
        if (hasSufficientTurnAssets(providedAssets, difficulty)) {
          canonicalAssets = providedAssets;
          break;
        }
      }
    }

    const resolvedAssets = cloneTurnAssets(
      requiresAssets
        ? ((canonicalAssets as TurnAsset[] | null) ?? generatedAssets)
        : []
    );

    for (const wrapper of wrappers) {
      const bit = wrapper.bit as { extraProperties?: unknown };
      const extras = isRecord(bit.extraProperties) ? bit.extraProperties : {};
      extras.turnAssets = cloneTurnAssets(resolvedAssets);
      bit.extraProperties = extras;
    }
  }
}

function buildSystemPrompt(
  topic: string,
  turnPlan: TurnPlanItem[],
  requirements?: string,
  questionBlueprint?: string
): string {
  const turns = turnPlan.length;
  const totalQuestions = turnPlan.reduce((sum, item) => sum + item.questionCount, 0);
  const turnPlanText = turnPlan
    .map(
      (item) =>
        `- Turn ${item.turn}: difficulty=${item.difficulty}, questionCount=${item.questionCount}, ids=${item.questionIds.join(", ")}`
    )
    .join("\n");
  const requirementText = requirements?.trim()
    ? `\nADDITIONAL REQUIREMENTS:\n"${requirements.trim()}"\n`
    : "";
  const compactBlueprint = questionBlueprint?.trim().slice(0, 2200);
  const blueprintText = compactBlueprint
    ? `\nQUESTION BLUEPRINT (use this as planning guidance):\n${compactBlueprint}\n`
    : "";

  return `You are an expert quiz designer producing CANONICAL Bitmark JSON wrappers.

TOPIC: "${topic}"
TURNS: ${turns}
TOTAL QUESTIONS: ${totalQuestions}
${requirementText}
${blueprintText}
TURN PLAN:
${turnPlanText}

Task:
1. Create exactly ${totalQuestions} quiz bits.
2. Infer what knowledge should be tested from the topic.
3. Apply any additional user requirements if they are present.
4. If QUESTION BLUEPRINT is present, follow it closely while preserving JSON validity.
5. Mix these supported quiz types appropriately:
   - "multiple-choice"
   - "true-false-1"
   - "question-1" (use this for short-answer style)
   - "essay"
   - "sequence"
6. Questions must be practical and scenario-based, not generic textbook phrasing.
7. Avoid simplistic stems like "What is one advantage..."; force specific decisions, comparisons, or explanations tied to the scenario.
8. Only require evidence reading when it genuinely helps answer the question.
9. When evidence is required, mention it explicitly in the question or instruction (for example: "use the table", "use the memo", "based on the case brief").
10. Build a continuous turn-by-turn case narrative: Turn N should logically continue from Turn N-1.
11. Keep JSON concise and avoid unnecessary narrative text in fields.

Output format (STRICT):
- Return ONLY a raw JSON array.
- Each array item MUST be a Bitmark wrapper with a "bit" object.
- Minimal wrapper shape:
  [
    {
      "bit": {
        "type": "multiple-choice",
      "format": "text",
      "id": "q1",
      "body": "Question text",
      "instruction": "Select one answer.",
      "choices": [
        { "choice": "Option A", "isCorrect": true },
        { "choice": "Option B", "isCorrect": false },
          { "choice": "Option C", "isCorrect": false },
          { "choice": "Option D", "isCorrect": false }
        ]
      }
    }
  ]

Type-specific fields:
- multiple-choice: include "choices" with exactly 4 options and exactly one isCorrect=true.
- true-false-1: include "statements" with one object { "statement": "True" or "False", "isCorrect": true }.
- question-1: include "body", "sampleSolution", and "instruction".
- essay: include "body", "sampleSolution", and "instruction".
- sequence: include "body", "responses" (ordered list with all isCorrect:true), and "instruction".

Supported tools (choose what is relevant per question):
- "calculator"
- "unit-converter"
- "data-workbench"
- "scratchpad"
- "text-highlighter"
- "image-reference"

Tool payload rules:
- Server attaches tool and evidence metadata after generation, so focus on high-quality questions and valid schema fields.

Rules:
- Use ids "q1"..."q${totalQuestions}" in order.
- Keep "format" = "text" on all bits.
- Include "instruction" for every bit and include "hint" when reasonable.
- Follow the turn plan exactly:
  - Turn difficulty must match the plan.
  - Question count per turn must match the plan.
- Do not leak the final answer in question text.
- No markdown fences.
- No explanation text.
- Only return valid JSON.`;
}

function tryParseGeneratedJson(text: string): unknown {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]);
    }

    const objectMatch = trimmed.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }

    throw new Error("AI returned invalid JSON.");
  }
}

function normalizeQuizMetadata(normalized: BitWrapperJson[], turnPlan: TurnPlanItem[]): void {
  let quizIndex = 0;

  for (const item of turnPlan) {
    for (let i = 0; i < item.questionCount; i += 1) {
      const wrapper = normalized[quizIndex];
      const bit = wrapper.bit as {
        id?: unknown;
        marks?: unknown;
        extraProperties?: {
          difficulty?: unknown;
          turn?: unknown;
          quizTools?: unknown;
          marks?: unknown;
        };
      };

      bit.id = item.questionIds[i];

      if (!bit.extraProperties || typeof bit.extraProperties !== "object") {
        bit.extraProperties = {};
      }

      bit.extraProperties.turn = item.turn;
      bit.extraProperties.difficulty = item.difficulty;
      const marks = MARKS_BY_DIFFICULTY[item.difficulty];
      bit.marks = marks;
      bit.extraProperties.marks = marks;
      quizIndex += 1;
    }
  }
}

function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) return false;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

type ImageGenerationOptions = {
  enabled: boolean;
  model: string;
  size: string;
  quality: string;
  maxImages: number;
};

function buildImageGenerationOptions(
  turns: number,
  requestWantsImages: boolean | undefined
): ImageGenerationOptions {
  const enabledByEnv = parseBooleanFlag(process.env.OPENAI_QUIZ_IMAGE_ENABLED);
  const enabled = requestWantsImages === true || enabledByEnv;

  return {
    enabled,
    model: process.env.OPENAI_QUIZ_IMAGE_MODEL?.trim() || "gpt-image-1",
    size: process.env.OPENAI_QUIZ_IMAGE_SIZE?.trim() || "1024x1024",
    quality: process.env.OPENAI_QUIZ_IMAGE_QUALITY?.trim() || "medium",
    maxImages: parsePositiveInt(
      process.env.OPENAI_QUIZ_IMAGE_MAX,
      Math.min(Math.max(2, turns), 10)
    ),
  };
}

async function generateOpenAiImageDataUrl(
  apiKey: string,
  model: string,
  prompt: string,
  size: string,
  quality: string
): Promise<string | null> {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      size,
      quality,
      response_format: "b64_json",
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    console.warn("OpenAI image generation request failed", {
      status: response.status,
      model,
      error: payload?.error?.message ?? "unknown error",
    });
    return null;
  }

  const first = Array.isArray(payload.data) ? payload.data[0] : undefined;
  if (first?.b64_json && typeof first.b64_json === "string") {
    return `data:image/png;base64,${first.b64_json}`;
  }
  if (first?.url && typeof first.url === "string") {
    return first.url;
  }

  return null;
}

function groupWrappersByTurn(normalized: BitWrapperJson[]): Map<number, BitWrapperJson[]> {
  const byTurn = new Map<number, BitWrapperJson[]>();

  for (const wrapper of normalized) {
    const bit = wrapper.bit as { extraProperties?: unknown };
    const extras = isRecord(bit.extraProperties) ? bit.extraProperties : {};
    const turn = readTurnNumberFromExtras(extras);
    const bucket = byTurn.get(turn) ?? [];
    bucket.push(wrapper);
    byTurn.set(turn, bucket);
  }

  return byTurn;
}

async function enhanceTurnAssetImagesWithOpenAI(
  normalized: BitWrapperJson[],
  topic: string,
  apiKey: string,
  options: ImageGenerationOptions,
  logStep: (stage: string, data?: Record<string, unknown>) => void
): Promise<void> {
  if (!options.enabled) {
    logStep("image-generation-skipped", { reason: "disabled" });
    return;
  }

  const byTurn = groupWrappersByTurn(normalized);
  const orderedTurns = Array.from(byTurn.entries()).sort((a, b) => a[0] - b[0]);
  const promptCache = new Map<string, Promise<string | null>>();
  let generatedCount = 0;
  let candidateCount = 0;

  logStep("image-generation-started", {
    model: options.model,
    size: options.size,
    quality: options.quality,
    maxImages: options.maxImages,
  });

  for (const [turn, wrappers] of orderedTurns) {
    if (generatedCount >= options.maxImages) break;
    if (wrappers.length === 0) continue;

    const firstBit = wrappers[0].bit as { extraProperties?: unknown };
    const firstExtras = isRecord(firstBit.extraProperties) ? firstBit.extraProperties : {};
    const firstAssets = Array.isArray(firstExtras.turnAssets) ? firstExtras.turnAssets : [];
    if (firstAssets.length === 0) continue;

    const updatedAssets = cloneTurnAssets(firstAssets as TurnAsset[]);
    let turnChanged = false;

    for (const asset of updatedAssets) {
      if (!isRecord(asset) || asset.type !== "image") continue;
      candidateCount += 1;
      if (generatedCount >= options.maxImages) break;

      const currentSrc = typeof asset.imageSrc === "string" ? asset.imageSrc.trim() : "";
      const shouldGenerate =
        currentSrc.length === 0 || currentSrc.startsWith("data:image/svg+xml");
      if (!shouldGenerate) {
        continue;
      }

      const imagePrompt =
        (typeof asset.imagePrompt === "string" && asset.imagePrompt.trim()) ||
        (typeof asset.title === "string" && asset.title.trim()) ||
        `${topic} turn ${turn} scenario evidence`;
      const normalizedPrompt = imagePrompt.slice(0, 900);
      const cacheKey = `${options.model}|${options.size}|${options.quality}|${normalizedPrompt}`;

      let task = promptCache.get(cacheKey);
      if (!task) {
        task = generateOpenAiImageDataUrl(
          apiKey,
          options.model,
          normalizedPrompt,
          options.size,
          options.quality
        );
        promptCache.set(cacheKey, task);
      }

      const imageSrc = await task;
      if (!imageSrc) {
        continue;
      }

      asset.imageSrc = imageSrc;
      asset.imagePrompt = normalizedPrompt;
      generatedCount += 1;
      turnChanged = true;
    }

    if (!turnChanged) {
      continue;
    }

    for (const wrapper of wrappers) {
      const bit = wrapper.bit as { extraProperties?: unknown };
      const extras = isRecord(bit.extraProperties) ? bit.extraProperties : {};
      extras.turnAssets = cloneTurnAssets(updatedAssets);
      bit.extraProperties = extras;
    }
  }

  logStep("image-generation-completed", {
    generatedCount,
    candidateCount,
    cacheEntries: promptCache.size,
  });
}

function buildQuestionBlueprintPrompt(
  topic: string,
  turnPlan: TurnPlanItem[],
  requirements?: string
): string {
  const requirementText = requirements?.trim()
    ? `\nAdditional requirements: "${requirements.trim()}"\n`
    : "";
  const turnPlanText = turnPlan
    .map(
      (item) =>
        `- Turn ${item.turn} (${item.difficulty}): ${item.questionIds.join(", ")}`
    )
    .join("\n");

  return `Design a thoughtful quiz blueprint for this topic:
Topic: "${topic}"
${requirementText}
Turn plan:
${turnPlanText}

Output strict JSON only. Output shape:
{
  "questions": [
    {
      "id": "q1",
      "turn": 1,
      "difficulty": "easy|medium|hard",
      "objective": "what the question tests",
      "reasoningType": "comparison|calculation|diagnosis|tradeoff|synthesis",
      "requiresEvidence": true,
      "recommendedEvidenceCount": 1
    }
  ]
}

Rules:
- Include every id from the plan exactly once.
- Questions should become more analytical by later turns.
- Do not provide final answers.
- Keep fields concise (1 short sentence each).`;
}

function validateTooling(normalized: BitWrapperJson[]): void {
  for (const wrapper of normalized) {
    const bit = wrapper.bit as {
      type?: unknown;
      body?: unknown;
      instruction?: unknown;
      hint?: unknown;
      extraProperties?: Record<string, unknown>;
    };

    if (!isRecord(bit.extraProperties)) {
      bit.extraProperties = {};
    }

    const extras = bit.extraProperties as Record<string, unknown>;
    const rawTools = Array.isArray(extras.quizTools) ? extras.quizTools : [];
    const signalText = [bit.body, bit.instruction, bit.hint]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .trim();
    const promptKeywords = extractKeywords(signalText, 5);

    const assetRefs = Array.isArray(extras.assetRefs)
      ? extras.assetRefs
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => entry.length > 0)
      : [];
    const turnAssets = Array.isArray(extras.turnAssets) ? extras.turnAssets : [];
    const assetById = new Map<string, Record<string, unknown>>();
    for (const asset of turnAssets) {
      if (!isRecord(asset) || typeof asset.id !== "string") continue;
      assetById.set(asset.id.trim(), asset);
    }

    const hasEvidenceRefs = assetRefs.length > 0;
    const hasImageEvidence = assetRefs.some((assetId) => {
      const asset = assetById.get(assetId);
      return isRecord(asset) && asset.type === "image";
    });

    const needsMath = /(calculate|compute|sum|count|avg|average|ratio|percent|difference|total|tax|cost|time|days|hours)/i.test(
      signalText
    );
    const needsUnits = /(convert|unit|celsius|fahrenheit|kelvin|meter|km|mile|kg|lb|liter|gallon)/i.test(
      signalText
    );
    const needsWorkbench = /(sql|query|join|group by|dataset|table|spreadsheet|trend|analy[sz]e|compare|filter|chart)/i.test(
      signalText
    );
    const needsNotepad =
      needsMath ||
      needsWorkbench ||
      bit.type === "essay" ||
      bit.type === "question-1";

    const normalizeToolName = (tool: unknown): string | null => {
      if (typeof tool !== "string") return null;
      if (tool === "table-helper") return "data-workbench";
      if (tool === "formula-sheet") return null;
      return tool.trim();
    };

    const selectedToolNames = new Set<string>();
    for (const entry of rawTools) {
      if (!isRecord(entry)) continue;
      const normalizedName = normalizeToolName(entry.tool);
      if (!normalizedName) continue;
      selectedToolNames.add(normalizedName);
    }

    if (needsWorkbench) selectedToolNames.add("data-workbench");
    if (needsMath || needsWorkbench) selectedToolNames.add("calculator");
    if (needsUnits) selectedToolNames.add("unit-converter");
    if (needsNotepad) selectedToolNames.add("scratchpad");
    if (hasEvidenceRefs) selectedToolNames.add("text-highlighter");
    if (hasImageEvidence) selectedToolNames.add("image-reference");
    if (selectedToolNames.size === 0) selectedToolNames.add("scratchpad");

    const resolvedTools: Array<Record<string, unknown>> = [];
    for (const toolName of selectedToolNames) {
      if (toolName === "calculator") {
        resolvedTools.push({
          tool: "calculator",
          label: "Calculator",
          purpose: "Perform numeric calculations while solving.",
          expectedOutput: "numeric-result",
        });
        continue;
      }

      if (toolName === "unit-converter") {
        resolvedTools.push({
          tool: "unit-converter",
          label: "Unit Converter",
          purpose: "Convert values between compatible units.",
          initialData: {
            category: "length",
            fromUnit: "m",
            toUnit: "ft",
            values: [1, 10, 100],
          },
          expectedOutput: "converted-values",
        });
        continue;
      }

      if (toolName === "scratchpad") {
        resolvedTools.push({
          tool: "scratchpad",
          label: "Scratchpad",
          purpose: "Draft intermediate reasoning and notes.",
          initialData: {
            template: "Key clue:\nCalculation:\nFinal check:",
          },
          expectedOutput: "free-text",
        });
        continue;
      }

      if (toolName === "text-highlighter") {
        resolvedTools.push({
          tool: "text-highlighter",
          label: "Highlighter",
          purpose: "Mark important clues from the prompt and evidence.",
          initialData: {
            text: typeof bit.body === "string" ? bit.body : "",
            keywords: promptKeywords,
          },
          expectedOutput: "highlighted-text",
        });
        continue;
      }

      if (toolName === "data-workbench") {
        const referencedTable = assetRefs
          .map((assetId) => assetById.get(assetId))
          .find((asset) => isRecord(asset) && (asset.type === "table" || asset.type === "spreadsheet"));
        const table = isRecord(referencedTable) && isRecord(referencedTable.table)
          ? referencedTable.table
          : null;
        const columns = Array.isArray(table?.columns)
          ? table.columns.map((entry) => String(entry))
          : ["col_a", "col_b"];
        const rows = Array.isArray(table?.rows)
          ? table.rows
              .filter((row) => Array.isArray(row))
              .slice(0, 12)
              .map((row) => (row as unknown[]).map((cell) => String(cell)))
          : [["sample", "0"]];

        resolvedTools.push({
          tool: "data-workbench",
          label: "Data Workbench",
          purpose: "Inspect and analyze referenced table data.",
          initialData: {
            columns,
            rows,
            modules: ["table", "chart", "sort", "filter", "formula", "stats"],
            chartSuggestions: ["bar", "line", "scatter"],
          },
          expectedOutput: "computed-answer",
        });
        continue;
      }

      if (toolName === "image-reference") {
        const images = assetRefs
          .map((assetId) => assetById.get(assetId))
          .filter((asset): asset is Record<string, unknown> => isRecord(asset) && asset.type === "image")
          .map((asset) => ({
            url: typeof asset.imageSrc === "string" ? asset.imageSrc : "",
            caption: typeof asset.title === "string" ? asset.title : "",
            alt: typeof asset.title === "string" ? asset.title : "Evidence image",
          }))
          .filter((image) => image.url.length > 0);

        if (images.length > 0) {
          resolvedTools.push({
            tool: "image-reference",
            label: "Image Reference",
            purpose: "Inspect referenced images while solving.",
            initialData: { images },
            expectedOutput: "image-observations",
          });
        }
      }
    }

    extras.quizTools = resolvedTools;
    bit.extraProperties = extras;
  }
}

export async function POST(req: NextRequest) {
  const requestId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const logStep = (stage: string, data?: Record<string, unknown>): void => {
    const elapsedMs = Date.now() - startedAt;
    if (data) {
      console.info(`[quiz-generate][${requestId}] +${elapsedMs}ms ${stage}`, data);
      return;
    }
    console.info(`[quiz-generate][${requestId}] +${elapsedMs}ms ${stage}`);
  };

  try {
    logStep("request-received");
    const body = await req.json();
    const { topic, requirements, turns, generateImages } = body as {
      topic: string;
      requirements?: string;
      turns: number | string;
      generateImages?: boolean;
    };

    const parsedTurns = Number(turns);
    const apiKey = process.env.OPENAI_API_KEY;
    const imageApiKey = process.env.OPENAI_IMAGE_API_KEY?.trim() || apiKey;

    if (!topic || !Number.isFinite(parsedTurns)) {
      return NextResponse.json(
        { error: "Missing required fields: topic, turns" },
        { status: 400 }
      );
    }

    if (parsedTurns < 1 || parsedTurns > 30) {
      return NextResponse.json(
        { error: "Turns must be between 1 and 30" },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: "Server is missing OPENAI_API_KEY configuration." },
        { status: 500 }
      );
    }

    const requestedImageOptions = buildImageGenerationOptions(parsedTurns, generateImages);
    const imageOptions: ImageGenerationOptions = {
      ...requestedImageOptions,
      enabled: requestedImageOptions.enabled && Boolean(imageApiKey),
    };

    logStep("input-validated", {
      turns: parsedTurns,
      topicLength: topic.trim().length,
      imageGenerationRequested: requestedImageOptions.enabled,
      imageGenerationEnabled: imageOptions.enabled,
    });

    const openai = createOpenAI({ apiKey });
    logStep("openai-client-ready");

    const turnPlan = buildTurnPlan(parsedTurns);
    const totalQuestions = turnPlan.reduce((sum, item) => sum + item.questionCount, 0);
    const writerMaxOutputTokens = Math.min(
      7000,
      Math.max(2600, totalQuestions * 320)
    );
    const enableBlueprint =
      process.env.OPENAI_QUIZ_ENABLE_BLUEPRINT == null
        ? true
        : parseBooleanFlag(process.env.OPENAI_QUIZ_ENABLE_BLUEPRINT);
    const plannerTimeoutMs = parsePositiveInt(process.env.OPENAI_QUIZ_PLANNER_TIMEOUT_MS, 25000);
    const writerTimeoutMs = parsePositiveInt(process.env.OPENAI_QUIZ_WRITER_TIMEOUT_MS, 90000);
    const fallbackWriterTimeoutMs = parsePositiveInt(
      process.env.OPENAI_QUIZ_WRITER_FALLBACK_TIMEOUT_MS,
      60000
    );
    const plannerModel =
      process.env.OPENAI_QUIZ_PLANNER_MODEL?.trim() ||
      process.env.OPENAI_QUIZ_MODEL?.trim() ||
      "gpt-5-mini";
    const writerModel =
      process.env.OPENAI_QUIZ_WRITER_MODEL?.trim() ||
      process.env.OPENAI_QUIZ_MODEL?.trim() ||
      "gpt-5-mini";
    const writerFallbackModel =
      process.env.OPENAI_QUIZ_WRITER_FALLBACK_MODEL?.trim() || "gpt-4o";

    logStep("model-selection", {
      plannerModel,
      writerModel,
      writerFallbackModel,
      imageModel: imageOptions.model,
      writerMaxOutputTokens,
      enableBlueprint,
      plannerTimeoutMs,
      writerTimeoutMs,
    });

    let questionBlueprint = "";
    let parsedQuizPayload: unknown = null;
    const writerPrompt = `Create a ${parsedTurns}-turn quiz about: ${topic}. Produce ${totalQuestions} total questions based on the turn difficulty plan.`;

    if (enableBlueprint) {
      try {
        logStep("question-blueprint-started");
        const blueprint = await withTimeout(
          "question-blueprint",
          plannerTimeoutMs,
          (abortSignal) =>
            generateText({
              model: openai(plannerModel),
              system: "You are a rigorous assessment designer. Return only valid JSON.",
              prompt: buildQuestionBlueprintPrompt(topic, turnPlan, requirements),
              abortSignal,
              ...buildGenerationSettings(plannerModel, 1200, 0.35),
            })
        );
        questionBlueprint = blueprint.text.trim();
        logStep("question-blueprint-completed", {
          blueprintLength: questionBlueprint.length,
        });
      } catch (plannerError) {
        logStep("question-blueprint-failed", {
          message: plannerError instanceof Error ? plannerError.message : "unknown",
        });
        console.warn(
          "Quiz blueprint generation failed, continuing without blueprint:",
          plannerError instanceof Error ? plannerError.message : plannerError
        );
      }
    } else {
      logStep("question-blueprint-skipped", {
        reason: "disabled",
      });
    }

    const writerSystem = buildSystemPrompt(
      topic,
      turnPlan,
      requirements,
      questionBlueprint
    );
    let text = "";
    let usedWriterModel = writerModel;
    try {
      logStep("writer-generation-started", {
        model: writerModel,
      });
      const generated = await withTimeout(
        "writer-generation",
        writerTimeoutMs,
        (abortSignal) =>
          generateText({
            model: openai(writerModel),
            system: writerSystem,
            prompt: writerPrompt,
            output: Output.array({
              element: QUIZ_WRAPPER_OUTPUT_SCHEMA,
              name: "quiz_wrappers",
              description: "Bitmark quiz wrappers",
            }),
            abortSignal,
            ...buildGenerationSettings(writerModel, writerMaxOutputTokens, 0.6),
          })
      );
      parsedQuizPayload = generated.output;
      text = JSON.stringify(generated.output);
      logStep("writer-generation-completed", {
        outputLength: text.length,
      });
    } catch (primaryWriterError) {
      if (writerModel === writerFallbackModel) {
        throw primaryWriterError;
      }

      logStep("writer-generation-failed", {
        model: writerModel,
        fallbackModel: writerFallbackModel,
        message: primaryWriterError instanceof Error ? primaryWriterError.message : "unknown",
      });
      console.warn(
        `Primary writer model "${writerModel}" failed, falling back to ${writerFallbackModel}:`,
        primaryWriterError instanceof Error ? primaryWriterError.message : primaryWriterError
      );

      logStep("writer-fallback-started", { model: writerFallbackModel });
      const fallbackGenerated = await withTimeout(
        "writer-fallback",
        fallbackWriterTimeoutMs,
        (abortSignal) =>
          generateText({
            model: openai(writerFallbackModel),
            system: writerSystem,
            prompt: writerPrompt,
            output: Output.array({
              element: QUIZ_WRAPPER_OUTPUT_SCHEMA,
              name: "quiz_wrappers",
              description: "Bitmark quiz wrappers",
            }),
            abortSignal,
            ...buildGenerationSettings(
              writerFallbackModel,
              writerMaxOutputTokens,
              0.6
            ),
          })
      );
      usedWriterModel = writerFallbackModel;
      parsedQuizPayload = fallbackGenerated.output;
      text = JSON.stringify(fallbackGenerated.output);
      logStep("writer-fallback-completed", {
        outputLength: text.length,
      });
    }

    logStep("response-parse-started");
    const generated =
      parsedQuizPayload ?? tryParseGeneratedJson(text);
    logStep("response-parse-completed", {
      mode: parsedQuizPayload ? "structured-output" : "text-parse-fallback",
    });
    const bpg = new BitmarkParserGenerator();

    logStep("bitmark-normalization-started");
    const normalized = bpg.convert(generated, {
      outputFormat: "json",
    }) as BitWrapperJson[];
    logStep("bitmark-normalization-completed", {
      normalizedCount: Array.isArray(normalized) ? normalized.length : 0,
    });

    if (!Array.isArray(normalized) || normalized.length === 0) {
      throw new Error("Generated output could not be converted to Bitmark JSON wrappers.");
    }

    if (normalized.length < totalQuestions) {
      throw new Error(
        `Expected at least ${totalQuestions} quiz bits from ${parsedTurns} turns, but got ${normalized.length} after Bitmark normalization.`
      );
    }

    // Enforce exact count requested by selected turns.
    const exactCount = normalized.slice(0, totalQuestions);

    logStep("post-processing-started", {
      exactCount: exactCount.length,
    });
    normalizeQuizMetadata(exactCount, turnPlan);
    ensureTurnAssets(exactCount, topic, turnPlan);
    ensureQuestionAssetRefs(exactCount);
    await enhanceTurnAssetImagesWithOpenAI(
      exactCount,
      topic,
      imageApiKey as string,
      imageOptions,
      logStep
    );
    validateTooling(exactCount);
    logStep("post-processing-completed");

    logStep("request-completed", {
      totalQuestions,
      totalTurns: parsedTurns,
    });

    return NextResponse.json({
      quiz: exactCount,
      rawText: text,
      turns: parsedTurns,
      totalQuestions,
      turnPlan,
      requestId,
      generationModels: {
        planner: plannerModel,
        writer: usedWriterModel,
        image: imageOptions.enabled ? imageOptions.model : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    logStep("request-failed", { message });
    console.error(`[quiz-generate][${requestId}] Quiz generation error:`, message);
    return NextResponse.json({ error: message, requestId }, { status: 500 });
  }
}

