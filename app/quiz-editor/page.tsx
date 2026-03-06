"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import QuestionCard from "@/components/QuestionCard";
import TypeSwitchModal from "@/components/TypeSwitchModal";
import { mockTurns } from "@/lib/mockQuizData";
import { buildQuizDataFromEditorTurns } from "@/lib/editor-to-quiz";
import { QUIZ_RUNTIME_SESSION_KEY } from "@/lib/quiz-runtime";
import {
  AnswerOption,
  EditorQuestion,
  QuestionType,
  SUPPORTED_TYPES,
  Turn,
} from "@/components/quizEditorTypes";
import styles from "@/styles/quiz-editor.module.css";

type PendingTypeSwitch = {
  turnId: string;
  questionId: string;
  nextType: QuestionType;
} | null;

const makeId = () => Math.random().toString(36).slice(2, 10);

const normalizeType = (input: unknown): QuestionType => {
  if (typeof input !== "string") return "multiple-choice";
  const cleaned = input.replace(/^\./, "");
  if (cleaned === "multiple-choice-1") return "multiple-choice";
  if (SUPPORTED_TYPES.includes(cleaned as QuestionType)) return cleaned as QuestionType;
  return "multiple-choice";
};

const cloneTurns = (turns: Turn[]): Turn[] =>
  turns.map((turn) => ({
    ...turn,
    questions: turn.questions.map((question) => ({
      ...question,
      options: question.options.map((option) => ({ ...option })),
      sourceBit: { ...(question.sourceBit ?? {}) },
    })),
  }));

const defaultInstruction = (type: QuestionType): string => {
  if (type === "multiple-choice") return "Choose one answer.";
  if (type === "true-false-1") return "Choose True or False.";
  if (type === "question-1") return "Answer briefly.";
  if (type === "essay") return "Write your answer.";
  return "Arrange the sequence in the correct order.";
};

const defaultMultipleChoiceOptions = (): AnswerOption[] => [
  { id: makeId(), text: "", isCorrect: true },
  { id: makeId(), text: "", isCorrect: false },
  { id: makeId(), text: "", isCorrect: false },
  { id: makeId(), text: "", isCorrect: false },
];

const defaultTrueFalseOptions = (): AnswerOption[] => [
  { id: makeId(), text: "True", isCorrect: true },
  { id: makeId(), text: "False", isCorrect: false },
];

const defaultSequenceOptions = (): AnswerOption[] => [
  { id: makeId(), text: "", isCorrect: true },
  { id: makeId(), text: "", isCorrect: true },
];

const defaultsForType = (
  type: QuestionType
): Pick<EditorQuestion, "options" | "sampleSolution" | "instruction"> => {
  if (type === "multiple-choice") {
    return {
      options: defaultMultipleChoiceOptions(),
      sampleSolution: "",
      instruction: defaultInstruction(type),
    };
  }
  if (type === "true-false-1") {
    return {
      options: defaultTrueFalseOptions(),
      sampleSolution: "",
      instruction: defaultInstruction(type),
    };
  }
  if (type === "sequence") {
    return {
      options: defaultSequenceOptions(),
      sampleSolution: "",
      instruction: defaultInstruction(type),
    };
  }
  return { options: [], sampleSolution: "", instruction: defaultInstruction(type) };
};

const emptyQuestion = (): EditorQuestion => ({
  id: `q-${makeId()}`,
  type: "multiple-choice",
  body: "",
  options: defaultMultipleChoiceOptions(),
  sampleSolution: "",
  instruction: defaultInstruction("multiple-choice"),
  sourceBit: {},
});

const parseArraySafe = (value: unknown): Record<string, unknown>[] | null => {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null;
    } catch {
      return null;
    }
  }
  return null;
};

const parseObjectSafe = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return null;
};

const readQuestionBody = (bit: Record<string, unknown>): string => {
  if (typeof bit.body === "string") return bit.body as string;
  if (typeof bit.item === "string") return bit.item as string;
  return "";
};

const readInstruction = (bit: Record<string, unknown>, type: QuestionType): string => {
  if (typeof bit.instruction === "string") return bit.instruction as string;
  if (typeof bit.hint === "string") return bit.hint as string;
  return defaultInstruction(type);
};

const readMultipleChoiceOptions = (bit: Record<string, unknown>): AnswerOption[] => {
  const choices = bit.choices;
  if (Array.isArray(choices)) {
    const normalized = choices.map((choice) => {
      const record = choice as Record<string, unknown>;
      return {
        id: makeId(),
        text: typeof record.choice === "string" ? (record.choice as string) : "",
        isCorrect: record.isCorrect === true,
      };
    });
    return normalized.length > 0 ? normalized : defaultMultipleChoiceOptions();
  }

  const responses = bit.responses;
  const solutions = Array.isArray(bit.solutions)
    ? (bit.solutions as Array<Record<string, unknown>>)
    : [];
  const correctValues = new Set(
    solutions
      .map((solution) => solution.response)
      .filter((response): response is string => typeof response === "string")
  );

  if (!Array.isArray(responses)) return defaultMultipleChoiceOptions();

  const normalized = responses.map((response) => {
    const text =
      typeof response === "string"
        ? response
        : typeof (response as Record<string, unknown>).response === "string"
          ? ((response as Record<string, unknown>).response as string)
          : typeof (response as Record<string, unknown>).text === "string"
            ? ((response as Record<string, unknown>).text as string)
            : "";

    return {
      id: makeId(),
      text,
      isCorrect: correctValues.has(text),
    };
  });

  return normalized.length > 0 ? normalized : defaultMultipleChoiceOptions();
};

const readTrueFalseOptions = (bit: Record<string, unknown>): AnswerOption[] => {
  const statements = bit.statements;
  if (Array.isArray(statements) && statements.length > 0) {
    const first = statements[0] as Record<string, unknown>;
    const value = typeof first.statement === "string" ? first.statement : "True";
    return [
      { id: makeId(), text: "True", isCorrect: value === "True" },
      { id: makeId(), text: "False", isCorrect: value === "False" },
    ];
  }
  return defaultTrueFalseOptions();
};

const readSequenceOptions = (bit: Record<string, unknown>): AnswerOption[] => {
  const responses = bit.responses;
  if (!Array.isArray(responses)) return defaultSequenceOptions();

  const normalized = responses.map((response) => {
    const record = response as Record<string, unknown>;
    const text =
      typeof response === "string"
        ? response
        : typeof record.response === "string"
          ? (record.response as string)
          : typeof record.text === "string"
            ? (record.text as string)
            : "";
    return { id: makeId(), text, isCorrect: true };
  });

  return normalized.length > 0 ? normalized : defaultSequenceOptions();
};

const readSampleSolution = (bit: Record<string, unknown>): string => {
  if (typeof bit.sampleSolution === "string") return bit.sampleSolution as string;
  const solutions = Array.isArray(bit.solutions)
    ? (bit.solutions as Array<Record<string, unknown>>)
    : [];
  const first = solutions[0]?.response;
  return typeof first === "string" ? first : "";
};

const normalizeQuestion = (bit: Record<string, unknown>): EditorQuestion => {
  const type = normalizeType(bit.type);
  return {
    id: typeof bit.id === "string" ? bit.id : `q-${makeId()}`,
    type,
    body: readQuestionBody(bit),
    options:
      type === "multiple-choice"
        ? readMultipleChoiceOptions(bit)
        : type === "true-false-1"
          ? readTrueFalseOptions(bit)
          : type === "sequence"
            ? readSequenceOptions(bit)
            : [],
    sampleSolution:
      type === "question-1" || type === "essay" ? readSampleSolution(bit) : "",
    instruction: readInstruction(bit, type),
    sourceBit: bit,
  };
};

const normalizeTurn = (turn: Record<string, unknown>, index: number): Turn => {
  const incomingQuestions = Array.isArray(turn.questions)
    ? (turn.questions as Array<Record<string, unknown>>)
    : [];

  const questions =
    incomingQuestions.length > 0
      ? incomingQuestions.map((question) => normalizeQuestion(question))
      : [emptyQuestion()];

  return {
    id: typeof turn.id === "string" ? (turn.id as string) : `turn-${index + 1}`,
    label: typeof turn.label === "string" ? (turn.label as string) : `Turn ${index + 1}`,
    questions,
  };
};

const readTurnNumber = (question: Record<string, unknown>, fallbackIndex: number): number => {
  const extraProperties = question.extraProperties;
  if (
    extraProperties &&
    typeof extraProperties === "object" &&
    !Array.isArray(extraProperties)
  ) {
    const turn = (extraProperties as Record<string, unknown>).turn;
    if (typeof turn === "number" && Number.isFinite(turn) && turn >= 1) {
      return Math.round(turn);
    }
  }
  return fallbackIndex + 1;
};

const questionsToTurns = (questions: Record<string, unknown>[]): Turn[] => {
  const grouped = new Map<number, Record<string, unknown>[]>();

  questions.forEach((question, index) => {
    const turnNumber = readTurnNumber(question, index);
    const bucket = grouped.get(turnNumber);
    if (bucket) {
      bucket.push(question);
      return;
    }
    grouped.set(turnNumber, [question]);
  });

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a - b)
    .map(([turnNumber, groupedQuestions]) => ({
      id: `turn-${turnNumber}`,
      label: `Turn ${turnNumber}`,
      questions: groupedQuestions.map((question) => normalizeQuestion(question)),
    }));
};

const serializeQuestion = (question: EditorQuestion) => {
  const nextBit: Record<string, unknown> = { ...question.sourceBit };
  nextBit.id = question.id;
  nextBit.type = question.type;
  nextBit.body = question.body;
  nextBit.instruction = question.instruction;

  delete nextBit.item;
  delete nextBit.choices;
  delete nextBit.responses;
  delete nextBit.solutions;
  delete nextBit.statements;
  delete nextBit.sampleSolution;

  if (question.type === "multiple-choice") {
    const prepared = [...question.options];
    while (prepared.length < 4) {
      prepared.push({ id: makeId(), text: "", isCorrect: false });
    }
    const firstCorrectIndex = prepared.findIndex((option) => option.isCorrect);
    const correctIndex = firstCorrectIndex >= 0 ? firstCorrectIndex : 0;
    nextBit.choices = prepared.slice(0, 4).map((option, index) => ({
      choice: option.text.trim(),
      isCorrect: index === correctIndex,
    }));
  }

  if (question.type === "true-false-1") {
    const trueOption = question.options.find((option) => option.text === "True");
    const statement = trueOption?.isCorrect ? "True" : "False";
    nextBit.statements = [{ statement, isCorrect: true }];
  }

  if (question.type === "question-1" || question.type === "essay") {
    nextBit.sampleSolution = question.sampleSolution.trim();
  }

  if (question.type === "sequence") {
    nextBit.responses = question.options
      .map((option) => option.text.trim())
      .filter((text) => text.length > 0)
      .map((response) => ({ response, isCorrect: true }));
  }

  return nextBit;
};

const markupTypeForExport = (type: QuestionType): string =>
  type === "multiple-choice" ? "multiple-choice-1" : type;

const buildBitmarkText = (turns: Turn[]) =>
  turns
    .flatMap((turn) => turn.questions)
    .map((question) => {
      const lines: string[] = [];
      lines.push(`[.${markupTypeForExport(question.type)}]`);
      lines.push(`[!${question.body || "Untitled question"}]`);

      if (question.instruction.trim()) {
        lines.push(`[?${question.instruction.trim()}]`);
      }

      if (question.type === "multiple-choice") {
        const choices = [...question.options];
        while (choices.length < 4) {
          choices.push({ id: makeId(), text: "", isCorrect: false });
        }

        const firstCorrectIndex = choices.findIndex((option) => option.isCorrect);
        const correctIndex = firstCorrectIndex >= 0 ? firstCorrectIndex : 0;

        choices.slice(0, 4).forEach((option, index) => {
          const text = option.text.trim();
          lines.push(index === correctIndex ? `[+${text}]` : `[-${text}]`);
        });
      }

      if (question.type === "true-false-1") {
        const trueOption = question.options.find((option) => option.text === "True");
        const trueIsCorrect = Boolean(trueOption?.isCorrect);
        lines.push(trueIsCorrect ? "[+True]" : "[-True]");
        lines.push(trueIsCorrect ? "[-False]" : "[+False]");
      }

      if ((question.type === "question-1" || question.type === "essay") && question.sampleSolution.trim()) {
        lines.push(`[=${question.sampleSolution.trim()}]`);
      }

      if (question.type === "sequence") {
        question.options
          .map((option) => option.text.trim())
          .filter((text) => text.length > 0)
          .forEach((text) => lines.push(`[+${text}]`));
      }

      return lines.join("\n");
    })
    .join("\n\n");

function SortableTurn({
  turn,
  activeEditId,
  onAddQuestion,
  onQuestionSelect,
  onBodyChange,
  onTypeChange,
  onOptionTextChange,
  onOptionCorrectChange,
  onAddOption,
  onRemoveOption,
  onSampleSolutionChange,
  onInstructionChange,
}: {
  turn: Turn;
  activeEditId: string | null;
  onAddQuestion: (turnId: string) => void;
  onQuestionSelect: (id: string) => void;
  onBodyChange: (turnId: string, questionId: string, value: string) => void;
  onTypeChange: (turnId: string, questionId: string, nextType: QuestionType) => void;
  onOptionTextChange: (turnId: string, questionId: string, optionId: string, value: string) => void;
  onOptionCorrectChange: (turnId: string, questionId: string, optionId: string, checked: boolean) => void;
  onAddOption: (turnId: string, questionId: string) => void;
  onRemoveOption: (turnId: string, questionId: string, optionId: string) => void;
  onSampleSolutionChange: (turnId: string, questionId: string, value: string) => void;
  onInstructionChange: (turnId: string, questionId: string, value: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: turn.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className={styles.turnCard}>
      <div className={styles.turnHeader}>
        <button
          type="button"
          className={styles.dragHandle}
          aria-label={`Drag ${turn.label}`}
          {...attributes}
          {...listeners}
        >
          ::
        </button>
        <strong>{turn.label}</strong>
        <span className={styles.turnMeta}>{turn.questions.length} question(s)</span>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => onAddQuestion(turn.id)}
        >
          Add Question
        </button>
      </div>

      <div className={styles.turnQuestions}>
        {turn.questions.map((question, questionIndex) => (
          <QuestionCard
            key={question.id}
            question={question}
            index={questionIndex}
            isActive={activeEditId === question.id}
            onSelect={onQuestionSelect}
            onBodyChange={(questionId, value) => onBodyChange(turn.id, questionId, value)}
            onTypeChange={(questionId, nextType) => onTypeChange(turn.id, questionId, nextType)}
            onOptionTextChange={(questionId, optionId, value) =>
              onOptionTextChange(turn.id, questionId, optionId, value)
            }
            onOptionCorrectChange={(questionId, optionId, checked) =>
              onOptionCorrectChange(turn.id, questionId, optionId, checked)
            }
            onAddOption={(questionId) => onAddOption(turn.id, questionId)}
            onRemoveOption={(questionId, optionId) =>
              onRemoveOption(turn.id, questionId, optionId)
            }
            onSampleSolutionChange={(questionId, value) =>
              onSampleSolutionChange(turn.id, questionId, value)
            }
            onInstructionChange={(questionId, value) =>
              onInstructionChange(turn.id, questionId, value)
            }
          />
        ))}
      </div>
    </div>
  );
}

export default function QuizEditorPage() {
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor));

  const [turns, setTurns] = useState<Turn[]>(() => cloneTurns(mockTurns));
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [pendingTypeSwitch, setPendingTypeSwitch] = useState<PendingTypeSwitch>(null);

  useEffect(() => {
    const incomingState =
      parseObjectSafe(window.history.state?.state) ??
      parseObjectSafe(new URLSearchParams(window.location.search).get("state"));

    const stateTurns = incomingState?.turns;

    if (Array.isArray(stateTurns)) {
      const normalizedTurns = (stateTurns as Array<Record<string, unknown>>).map((turn, index) =>
        normalizeTurn(turn, index)
      );
      setTurns(normalizedTurns);
      setActiveEditId(normalizedTurns[0]?.questions[0]?.id ?? null);
      return;
    }

    const fromStorage = window.sessionStorage.getItem("quiz-editor:questions");
    const questionBits = parseArraySafe(fromStorage);
    if (questionBits && questionBits.length > 0) {
      const normalizedTurns = questionsToTurns(questionBits);
      setTurns(normalizedTurns);
      setActiveEditId(normalizedTurns[0]?.questions[0]?.id ?? null);
      return;
    }

    const fallbackTurns = cloneTurns(mockTurns);
    setTurns(fallbackTurns);
    setActiveEditId(fallbackTurns[0]?.questions[0]?.id ?? null);
  }, []);

  const turnIds = useMemo(() => turns.map((turn) => turn.id), [turns]);

  const updateQuestion = (
    turnId: string,
    questionId: string,
    updater: (question: EditorQuestion) => EditorQuestion
  ) => {
    setTurns((prev) =>
      prev.map((turn) =>
        turn.id !== turnId
          ? turn
          : {
              ...turn,
              questions: turn.questions.map((question) =>
                question.id === questionId ? updater(question) : question
              ),
            }
      )
    );
  };

  const handleTurnDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setTurns((prev) => {
      const oldIndex = prev.findIndex((turn) => turn.id === active.id);
      const newIndex = prev.findIndex((turn) => turn.id === over.id);
      return arrayMove(prev, oldIndex, newIndex);
    });
  };

  const handleTypeSelect = (turnId: string, questionId: string, nextType: QuestionType) => {
    const currentTurn = turns.find((turn) => turn.id === turnId);
    const currentQuestion = currentTurn?.questions.find((question) => question.id === questionId);
    if (!currentQuestion || currentQuestion.type === nextType) return;
    setPendingTypeSwitch({ turnId, questionId, nextType });
  };

  const confirmTypeSwitch = () => {
    if (!pendingTypeSwitch) return;

    const { turnId, questionId, nextType } = pendingTypeSwitch;
    updateQuestion(turnId, questionId, (question) => ({
      ...question,
      type: nextType,
      ...defaultsForType(nextType),
    }));
    setPendingTypeSwitch(null);
  };

  const addQuestionToTurn = (turnId: string) => {
    const question = emptyQuestion();
    setTurns((prev) =>
      prev.map((turn) =>
        turn.id === turnId ? { ...turn, questions: [...turn.questions, question] } : turn
      )
    );
    setActiveEditId(question.id);
  };

  const addTurn = () => {
    const nextTurn: Turn = {
      id: `turn-${makeId()}`,
      label: `Turn ${turns.length + 1}`,
      questions: [emptyQuestion()],
    };
    setTurns((prev) => [...prev, nextTurn]);
  };

  const confirmAndContinue = () => {
    const finalTurns = turns.map((turn) => ({
      ...turn,
      questions: turn.questions.map((question) => ({
        ...question,
        sourceBit: serializeQuestion(question),
      })),
    }));

    const runtimeQuiz = buildQuizDataFromEditorTurns(finalTurns);
    window.sessionStorage.setItem(QUIZ_RUNTIME_SESSION_KEY, JSON.stringify(runtimeQuiz));
    router.push("/quiz");
  };

  const exportBitmarkFile = () => {
    const bitmarkText = buildBitmarkText(turns);
    const blob = new Blob([bitmarkText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const dateStamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = `quiz-${dateStamp}.bitmark`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <main className={styles.page}>
      <section className={`${styles.leftPanel} ${styles.fullSpan}`}>
        <div className={styles.panelTop}>
          <h2>Turns</h2>
          <div className={styles.actionRow}>
            <button type="button" className={styles.primaryButton} onClick={addTurn}>
              Add Turn
            </button>
            <button type="button" className={styles.secondaryButton} onClick={exportBitmarkFile}>
              Export .bitmark
            </button>
          </div>
        </div>

        <DndContext sensors={sensors} onDragEnd={handleTurnDragEnd}>
          <SortableContext items={turnIds} strategy={verticalListSortingStrategy}>
            <div className={styles.cardList}>
              {turns.map((turn) => (
                <SortableTurn
                  key={turn.id}
                  turn={turn}
                  activeEditId={activeEditId}
                  onAddQuestion={addQuestionToTurn}
                  onQuestionSelect={setActiveEditId}
                  onBodyChange={(turnId, questionId, value) =>
                    updateQuestion(turnId, questionId, (previous) => ({ ...previous, body: value }))
                  }
                  onTypeChange={handleTypeSelect}
                  onOptionTextChange={(turnId, questionId, optionId, value) =>
                    updateQuestion(turnId, questionId, (previous) => ({
                      ...previous,
                      options: previous.options.map((option) =>
                        option.id === optionId ? { ...option, text: value } : option
                      ),
                    }))
                  }
                  onOptionCorrectChange={(turnId, questionId, optionId, checked) =>
                    updateQuestion(turnId, questionId, (previous) => ({
                      ...previous,
                      options: previous.options.map((option) => {
                        if (option.id !== optionId) {
                          if (
                            previous.type === "multiple-choice" ||
                            previous.type === "true-false-1"
                          ) {
                            return { ...option, isCorrect: false };
                          }
                          return option;
                        }
                        return { ...option, isCorrect: checked };
                      }),
                    }))
                  }
                  onAddOption={(turnId, questionId) =>
                    updateQuestion(turnId, questionId, (previous) => ({
                      ...previous,
                      options: [
                        ...previous.options,
                        {
                          id: makeId(),
                          text: "",
                          isCorrect: previous.type === "sequence",
                        },
                      ],
                    }))
                  }
                  onRemoveOption={(turnId, questionId, optionId) =>
                    updateQuestion(turnId, questionId, (previous) => ({
                      ...previous,
                      options: previous.options.filter((option) => option.id !== optionId),
                    }))
                  }
                  onSampleSolutionChange={(turnId, questionId, value) =>
                    updateQuestion(turnId, questionId, (previous) => ({
                      ...previous,
                      sampleSolution: value,
                    }))
                  }
                  onInstructionChange={(turnId, questionId, value) =>
                    updateQuestion(turnId, questionId, (previous) => ({
                      ...previous,
                      instruction: value,
                    }))
                  }
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>

      <button type="button" className={styles.confirmButton} onClick={confirmAndContinue}>
        Confirm
      </button>

      <TypeSwitchModal
        open={pendingTypeSwitch !== null}
        nextType={pendingTypeSwitch?.nextType}
        onCancel={() => setPendingTypeSwitch(null)}
        onConfirm={confirmTypeSwitch}
      />
    </main>
  );
}
