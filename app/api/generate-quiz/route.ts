import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import {
  BitmarkParserGenerator,
  type BitWrapperJson,
} from "@gmb/bitmark-parser-generator";

function buildSystemPrompt(topic: string, turns: number, requirements?: string): string {
  const requirementText = requirements?.trim()
    ? `\nADDITIONAL REQUIREMENTS:\n"${requirements.trim()}"\n`
    : "";

  return `You are an expert quiz designer producing CANONICAL Bitmark JSON wrappers.

TOPIC: "${topic}"
TURNS: ${turns}
${requirementText}

Task:
1. Create exactly ${turns} quiz bits.
2. Infer what knowledge should be tested from the topic.
3. Apply any additional user requirements if they are present.
4. Mix these supported quiz types appropriately:
   - "multiple-choice"
   - "true-false-1"
   - "question-1" (use this for short-answer style)
   - "essay"
   - "sequence"
5. For EVERY question, include tool metadata in "extraProperties.quizTools" so the app can render dynamic tools.
6. Multiple tools are allowed and expected when useful for solving the question.

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
      "extraProperties": {
        "quizTools": [
          {
            "tool": "data-workbench",
            "label": "Data Workbench",
            "purpose": "Analyze dataset to answer the question",
            "initialData": {
              "columns": ["Month", "Sales"],
              "rows": [["Jan", 120], ["Feb", 95]],
              "modules": ["table", "chart", "sort", "filter", "formula", "stats"],
              "chartSuggestions": ["line", "bar"]
            },
            "expectedOutput": "computed-answer"
          }
        ]
      },
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
- "formula-sheet"
- "unit-converter"
- "data-workbench"
- "scratchpad"
- "text-highlighter"
- "image-reference"

Tool payload rules:
- Every bit MUST include "extraProperties.quizTools" (array; can be empty if truly unnecessary).
- Every bit MUST always include:
  - "calculator"
  - "scratchpad"
  - "text-highlighter"
- For "data-workbench", include structured data in initialData:
  {
    "columns": ["Month", "Sales"],
    "rows": [["Jan", 120], ["Feb", 95]],
    "modules": ["table", "chart", "sort", "filter", "formula", "stats"],
    "chartSuggestions": ["bar", "line"]
  }
- "modules" should use mostly-used data processing features only:
  - "table"
  - "chart"
  - "sort"
  - "filter"
  - "formula"
  - "stats"
- Use "chartSuggestions" when charting helps.
- For "formula-sheet", include initialData.formulas as array of { "name", "formula", "note" }.
- For "calculator", do NOT include any input data payload. Only declare the tool so the UI shows a calculator.
- For "unit-converter", include initialData with { "category", "fromUnit", "toUnit", "values" } when needed.
- For "text-highlighter", include initialData.text and optional initialData.keywords.
- For "scratchpad", include initialData.template when useful.
- For "image-reference", include initialData.images:
  [{ "url": "https://...", "caption": "optional", "alt": "optional" }]
- Use multiple tools in the same question whenever that improves solvability.

Rules:
- Use ids "q1"..."q${turns}" in order.
- Keep "format" = "text" on all bits.
- Include "instruction" for every bit and include "hint" when reasonable.
- Ensure tool data is sufficient for users to solve the question without missing context.
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

function validateTooling(normalized: BitWrapperJson[]): void {
  for (const wrapper of normalized) {
    const bit = wrapper.bit;
    const bitWithExtras = bit as { extraProperties?: { quizTools?: unknown } };

    if (!bitWithExtras.extraProperties || typeof bitWithExtras.extraProperties !== "object") {
      bitWithExtras.extraProperties = { quizTools: [] };
      continue;
    }

    if (!Array.isArray(bitWithExtras.extraProperties.quizTools)) {
      bitWithExtras.extraProperties.quizTools = [];
    }

    const quizTools = bitWithExtras.extraProperties.quizTools as unknown[];

    bitWithExtras.extraProperties.quizTools = quizTools.map(
      (toolEntry) => {
        if (!toolEntry || typeof toolEntry !== "object") return toolEntry;
        const toolRecord = toolEntry as { tool?: unknown; initialData?: unknown };

        // Backward compatibility: migrate old table-helper tool to the new data-workbench tool.
        if (toolRecord.tool === "table-helper") {
          const initialData =
            toolRecord.initialData && typeof toolRecord.initialData === "object"
              ? (toolRecord.initialData as Record<string, unknown>)
              : {};
          if (!Array.isArray(initialData.modules)) {
            initialData.modules = ["table", "chart", "sort", "filter", "formula", "stats"];
          }

          return {
            ...toolRecord,
            tool: "data-workbench",
            label: "Data Workbench",
            initialData,
          };
        }

        return toolEntry;
      }
    );

    const ensuredTools = bitWithExtras.extraProperties.quizTools as unknown[];
    const hasTool = (name: string) =>
      ensuredTools.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          "tool" in entry &&
          (entry as { tool?: unknown }).tool === name
      );

    if (!hasTool("scratchpad")) {
      ensuredTools.push({
        tool: "scratchpad",
        label: "Scratchpad",
        purpose: "Work through the answer",
        initialData: { template: "" },
        expectedOutput: "free-text",
      });
    }

    if (!hasTool("text-highlighter")) {
      const bodyText = typeof bit.body === "string" ? bit.body : "";
      ensuredTools.push({
        tool: "text-highlighter",
        label: "Highlighter",
        purpose: "Highlight important parts of the question",
        initialData: { text: bodyText, keywords: [] },
        expectedOutput: "highlighted-text",
      });
    }

    if (!hasTool("calculator")) {
      ensuredTools.push({
        tool: "calculator",
        label: "Calculator",
        purpose: "Perform calculations needed for solving the question",
        expectedOutput: "numeric-result",
      });
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topic, requirements, turns } = body as {
      topic: string;
      requirements?: string;
      turns: number | string;
    };

    const parsedTurns = Number(turns);
    const apiKey = process.env.OPENAI_API_KEY;

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

    const openai = createOpenAI({ apiKey });

    const { text } = await generateText({
      model: openai("gpt-4o"),
      system: buildSystemPrompt(topic, parsedTurns, requirements),
      prompt: `Create a ${parsedTurns}-turn quiz about: ${topic}`,
      maxOutputTokens: 4096,
      temperature: 0.7,
    });

    const generated = tryParseGeneratedJson(text);
    const bpg = new BitmarkParserGenerator();

    const normalized = bpg.convert(generated, {
      outputFormat: "json",
    }) as BitWrapperJson[];

    if (!Array.isArray(normalized) || normalized.length === 0) {
      throw new Error("Generated output could not be converted to Bitmark JSON wrappers.");
    }

    if (normalized.length !== parsedTurns) {
      throw new Error(
        `Expected ${parsedTurns} quiz bits, but got ${normalized.length} after Bitmark normalization.`
      );
    }

    validateTooling(normalized);

    return NextResponse.json({ quiz: normalized, rawText: text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error occurred";
    console.error("Quiz generation error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

