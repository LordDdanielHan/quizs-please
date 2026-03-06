"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import QuestionCard from "@/components/QuestionCard";
import FlowEditor from "@/components/FlowEditor";
import TypeSwitchModal from "@/components/TypeSwitchModal";
import EdgeConfigModal from "@/components/EdgeConfigModal";
import {
  AnswerOption,
  EditorQuestion,
  FlowMap,
  NodePositionMap,
  QuestionType,
  SUPPORTED_TYPES,
} from "@/components/quizEditorTypes";
import styles from "@/styles/quiz-editor.module.css";

type PendingTypeSwitch = {
  questionId: string;
  nextType: QuestionType;
} | null;

type PendingEdgeEdit = {
  questionId: string;
  branchType: "correct" | "incorrect";
} | null;

const makeId = () => Math.random().toString(36).slice(2, 10);

const normalizeType = (input: unknown): QuestionType => {
  const cleaned =
    typeof input === "string" ? input.replace(/^\./, "") : "multiple-choice";
  if (SUPPORTED_TYPES.includes(cleaned as QuestionType)) {
    return cleaned as QuestionType;
  }
  return "multiple-choice";
};

const defaultOptions = (count = 2): AnswerOption[] =>
  Array.from({ length: count }, () => ({ id: makeId(), text: "", isCorrect: false }));

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

const defaultInstructionForType = (type: QuestionType): string => {
  if (type === "multiple-choice") return "Select one answer.";
  if (type === "true-false-1") return "Select whether the statement is true or false.";
  if (type === "question-1") return "Provide a short answer.";
  if (type === "sequence") return "Arrange the responses in the correct order.";
  return "Write your answer.";
};

const defaultsForType = (type: QuestionType): Pick<EditorQuestion, "options" | "sampleSolution" | "instruction"> => {
  if (type === "multiple-choice") {
    return {
      options: defaultMultipleChoiceOptions(),
      sampleSolution: "",
      instruction: defaultInstructionForType(type),
    };
  }
  if (type === "true-false-1") {
    return {
      options: defaultTrueFalseOptions(),
      sampleSolution: "",
      instruction: defaultInstructionForType(type),
    };
  }
  if (type === "sequence") {
    return {
      options: defaultOptions(),
      sampleSolution: "",
      instruction: defaultInstructionForType(type),
    };
  }
  return { options: [], sampleSolution: "", instruction: defaultInstructionForType(type) };
};

const parseArraySafe = (value: unknown): Record<string, unknown>[] | null => {
  if (Array.isArray(value)) {
    return value as Record<string, unknown>[];
  }
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

const readQuestionBody = (bit: Record<string, unknown>): string => {
  const body = bit.body;
  if (typeof body === "string") {
    return body;
  }
  const item = bit.item;
  if (typeof item === "string") {
    return item;
  }
  const cardNode = bit.cardNode as Record<string, unknown> | undefined;
  if (cardNode && typeof cardNode.body === "string") {
    return cardNode.body;
  }
  return "";
};

const readInstruction = (bit: Record<string, unknown>, type: QuestionType): string => {
  return typeof bit.instruction === "string"
    ? (bit.instruction as string)
    : defaultInstructionForType(type);
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

  if (!Array.isArray(responses)) {
    return defaultOptions();
  }
  const normalized = responses.map((response) => {
    const text =
      typeof response === "string"
        ? response
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
  if (Array.isArray(statements)) {
    const first = statements[0] as Record<string, unknown> | undefined;
    const correctStatement = first && typeof first.statement === "string" ? first.statement : "True";
    return [
      { id: makeId(), text: "True", isCorrect: correctStatement === "True" },
      { id: makeId(), text: "False", isCorrect: correctStatement === "False" },
    ];
  }
  return defaultTrueFalseOptions();
};

const readSequenceResponses = (bit: Record<string, unknown>): AnswerOption[] => {
  const responses = bit.responses;
  if (!Array.isArray(responses)) {
    return defaultOptions();
  }
  const normalized = responses.map((response) => {
    const record = response as Record<string, unknown>;
    return {
      id: makeId(),
      text:
        typeof response === "string"
          ? response
          : typeof record.response === "string"
            ? (record.response as string)
            : typeof record.text === "string"
              ? (record.text as string)
              : "",
      isCorrect: true,
    };
  });
  return normalized.length > 0 ? normalized : defaultOptions();
};

const readSampleSolution = (bit: Record<string, unknown>): string => {
  if (typeof bit.sampleSolution === "string") {
    return bit.sampleSolution as string;
  }
  const solutions = Array.isArray(bit.solutions)
    ? (bit.solutions as Array<Record<string, unknown>>)
    : [];
  const first = solutions[0]?.response;
  return typeof first === "string" ? first : "";
};

const normalizeQuestion = (bit: Record<string, unknown>): EditorQuestion => {
  const type = normalizeType(bit.type);
  return {
    id: typeof bit.id === "string" ? bit.id : makeId(),
    type,
    body: readQuestionBody(bit),
    options:
      type === "multiple-choice"
        ? readMultipleChoiceOptions(bit)
        : type === "true-false-1"
          ? readTrueFalseOptions(bit)
          : type === "sequence"
            ? readSequenceResponses(bit)
            : [],
    sampleSolution:
      type === "question-1" || type === "essay" ? readSampleSolution(bit) : "",
    instruction: readInstruction(bit, type),
    sourceBit: bit,
  };
};

const serializeQuestion = (question: EditorQuestion, flow: FlowMap) => {
  const nextBit: Record<string, unknown> = { ...question.sourceBit };
  nextBit.id = question.id;
  nextBit.type = question.type;
  nextBit.body = question.body;
  nextBit.instruction = question.instruction.trim() || defaultInstructionForType(question.type);

  delete nextBit.item;
  delete nextBit.choices;
  delete nextBit.statements;
  delete nextBit.responses;
  delete nextBit.solutions;
  delete nextBit.pairs;
  delete nextBit.sampleSolution;

  if (question.type === "multiple-choice") {
    const cleanedOptions = question.options.map((option) => ({
      ...option,
      text: option.text.trim(),
    }));
    while (cleanedOptions.length < 4) {
      cleanedOptions.push({ id: makeId(), text: "", isCorrect: false });
    }
    const exactFour = cleanedOptions.slice(0, 4);
    const firstCorrectIndex = exactFour.findIndex((option) => option.isCorrect);
    const normalizedCorrectIndex = firstCorrectIndex >= 0 ? firstCorrectIndex : 0;
    nextBit.choices = exactFour.map((option, index) => ({
      choice: option.text,
      isCorrect: index === normalizedCorrectIndex,
    }));
  }

  if (question.type === "true-false-1") {
    const trueOption = question.options.find((option) => option.text === "True");
    const falseOption = question.options.find((option) => option.text === "False");
    const correctStatement = trueOption?.isCorrect
      ? "True"
      : falseOption?.isCorrect
        ? "False"
        : "True";
    nextBit.statements = [{ statement: correctStatement, isCorrect: true }];
  }

  if (question.type === "question-1" || question.type === "essay") {
    nextBit.sampleSolution = question.sampleSolution.trim();
  }

  if (question.type === "sequence") {
    const cleanedResponses = question.options
      .map((option) => option.text.trim())
      .filter((text) => text.length > 0);
    nextBit.responses = cleanedResponses.map((response) => ({
      response,
      isCorrect: true,
    }));
  }

  nextBit.flow = flow[question.id] ?? { correct: "end", incorrect: "end" };
  return nextBit;
};

const emptyQuestion = (): EditorQuestion => ({
  id: makeId(),
  type: "multiple-choice",
  body: "",
  options: defaultMultipleChoiceOptions(),
  sampleSolution: "",
  instruction: defaultInstructionForType("multiple-choice"),
  sourceBit: {},
});

export default function QuizEditorPage() {
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor));

  const [questions, setQuestions] = useState<EditorQuestion[]>([]);
  const [flow, setFlow] = useState<FlowMap>({});
  const [nodePositions, setNodePositions] = useState<NodePositionMap>({});
  const [activeEditId, setActiveEditId] = useState<string | null>(null);
  const [pendingTypeSwitch, setPendingTypeSwitch] = useState<PendingTypeSwitch>(null);
  const [pendingEdgeEdit, setPendingEdgeEdit] = useState<PendingEdgeEdit>(null);
  const [isReady, setIsReady] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isReady) {
      return;
    }

    const fromHistoryState =
      window.history.state?.questions ??
      window.history.state?.usr?.questions ??
      window.history.state?.state?.questions;
    const fromStorage = window.sessionStorage.getItem("quiz-editor:questions");
    const fromQuery = new URLSearchParams(window.location.search).get("questions");

    const incomingBits =
      parseArraySafe(fromHistoryState) ??
      parseArraySafe(fromStorage) ??
      parseArraySafe(fromQuery);

    if (!incomingBits || incomingBits.length === 0) {
      setQuestions([]);
      setFlow({});
      setIsReady(true);
      return;
    }

    const normalized = incomingBits.map((bit) => normalizeQuestion(bit));
    setQuestions(normalized);
    setActiveEditId(normalized[0]?.id ?? null);

    const nextFlow: FlowMap = {};
    const nextPositions: NodePositionMap = {};
    normalized.forEach((question, index) => {
      const defaultCorrect = normalized[index + 1]?.id ?? "end";
      const currentBit = incomingBits[index];
      const incomingFlow = currentBit.flow as Record<string, unknown> | undefined;
      nextFlow[question.id] = {
        correct:
          typeof incomingFlow?.correct === "string"
            ? (incomingFlow.correct as string)
            : defaultCorrect,
        incorrect:
          typeof incomingFlow?.incorrect === "string"
            ? (incomingFlow.incorrect as string)
            : "end",
      };
      nextPositions[question.id] = { x: 220, y: 100 + index * 120 };
    });
    setFlow(nextFlow);
    setNodePositions(nextPositions);
    setIsReady(true);
  }, [isReady]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const questionIds = useMemo(() => questions.map((question) => question.id), [questions]);

  const updateQuestion = (
    questionId: string,
    updater: (question: EditorQuestion) => EditorQuestion
  ) => {
    setQuestions((prev) =>
      prev.map((question) => (question.id === questionId ? updater(question) : question))
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setQuestions((prev) => {
      const oldIndex = prev.findIndex((question) => question.id === active.id);
      const newIndex = prev.findIndex((question) => question.id === over.id);
      const reordered = arrayMove(prev, oldIndex, newIndex);
      setNodePositions((current) => {
        const next = { ...current };
        reordered.forEach((question, index) => {
          const previous = next[question.id] ?? { x: 220, y: 100 + index * 120 };
          next[question.id] = { ...previous, y: 100 + index * 120 };
        });
        return next;
      });
      return reordered;
    });
  };

  const handleTypeSelect = (questionId: string, nextType: QuestionType) => {
    const current = questions.find((question) => question.id === questionId);
    if (!current || current.type === nextType) {
      return;
    }
    setPendingTypeSwitch({ questionId, nextType });
  };

  const confirmTypeSwitch = () => {
    if (!pendingTypeSwitch) {
      return;
    }
    const { questionId, nextType } = pendingTypeSwitch;
    updateQuestion(questionId, (question) => ({
      ...question,
      type: nextType,
      ...defaultsForType(nextType),
    }));
    setPendingTypeSwitch(null);
  };

  const addQuestion = () => {
    const nextQuestion = emptyQuestion();
    setQuestions((prev) => {
      const nextList = [...prev, nextQuestion];
      setNodePositions((current) => ({
        ...current,
        [nextQuestion.id]: { x: 220, y: 100 + prev.length * 120 },
      }));
      setFlow((currentFlow) => ({
        ...currentFlow,
        [nextQuestion.id]: { correct: "end", incorrect: "end" },
      }));
      return nextList;
    });
    setActiveEditId(nextQuestion.id);
  };

  const confirmAndContinue = () => {
    const finalJSON = questions.map((question) => serializeQuestion(question, flow));
    window.sessionStorage.setItem("next-page:questions", JSON.stringify(finalJSON));
    router.push("/next-page");
  };

  if (!isReady) {
    return <main className={styles.page}>Loading editor...</main>;
  }

  if (questions.length === 0) {
    return (
      <main className={styles.page}>
        <div className={styles.emptyState}>
          No questions found. Please go back and generate questions first.
        </div>
      </main>
    );
  }

  const pendingEdgeTarget = pendingEdgeEdit
    ? flow[pendingEdgeEdit.questionId]?.[pendingEdgeEdit.branchType] ?? "end"
    : "end";

  return (
    <main className={styles.page}>
      <section className={styles.leftPanel}>
        <div className={styles.panelTop}>
          <h2>Questions</h2>
          <button type="button" className={styles.primaryButton} onClick={addQuestion}>
            Add Question
          </button>
        </div>

        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <SortableContext items={questionIds} strategy={verticalListSortingStrategy}>
            <div className={styles.cardList}>
              {questions.map((question, index) => (
                <QuestionCard
                  key={question.id}
                  question={question}
                  index={index}
                  isActive={activeEditId === question.id}
                  onSelect={setActiveEditId}
                  onBodyChange={(id, value) =>
                    updateQuestion(id, (previous) => ({ ...previous, body: value }))
                  }
                  onTypeChange={handleTypeSelect}
                  onOptionTextChange={(id, optionId, value) =>
                    updateQuestion(id, (previous) => ({
                      ...previous,
                      options: previous.options.map((option) =>
                        option.id === optionId ? { ...option, text: value } : option
                      ),
                    }))
                  }
                  onOptionCorrectChange={(id, optionId, checked) =>
                    updateQuestion(id, (previous) => ({
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
                  onAddOption={(id) =>
                    updateQuestion(id, (previous) => ({
                      ...previous,
                      options: [
                        ...previous.options,
                        { id: makeId(), text: "", isCorrect: false },
                      ],
                    }))
                  }
                  onRemoveOption={(id, optionId) =>
                    updateQuestion(id, (previous) => ({
                      ...previous,
                      options: previous.options.filter((option) => option.id !== optionId),
                    }))
                  }
                  onSampleSolutionChange={(id, value) =>
                    updateQuestion(id, (previous) => ({
                      ...previous,
                      sampleSolution: value,
                    }))
                  }
                  onInstructionChange={(id, value) =>
                    updateQuestion(id, (previous) => ({
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

      <section className={styles.rightPanel}>
        <h2>Question Flow</h2>
        <p className={styles.helperText}>Click any Correct/Incorrect edge to reassign its target.</p>
        <FlowEditor
          questions={questions}
          flow={flow}
          nodePositions={nodePositions}
          onPositionsChange={setNodePositions}
          onEditEdge={(sourceQuestionId, branchType) =>
            setPendingEdgeEdit({ questionId: sourceQuestionId, branchType })
          }
        />
      </section>

      <button type="button" className={styles.confirmButton} onClick={confirmAndContinue}>
        Confirm
      </button>

      <TypeSwitchModal
        open={pendingTypeSwitch !== null}
        onCancel={() => setPendingTypeSwitch(null)}
        onConfirm={confirmTypeSwitch}
      />

      <EdgeConfigModal
        open={pendingEdgeEdit !== null}
        questionLabel={
          pendingEdgeEdit
            ? `Q${
                questions.findIndex((question) => question.id === pendingEdgeEdit.questionId) + 1
              }`
            : ""
        }
        branchType={pendingEdgeEdit?.branchType ?? "correct"}
        currentTarget={pendingEdgeTarget}
        options={questions
          .filter((question) => question.id !== pendingEdgeEdit?.questionId)
          .map((question, index) => ({
            id: question.id,
            label: `Q${index + 1}`,
          }))}
        onClose={() => setPendingEdgeEdit(null)}
        onSave={(target) => {
          if (!pendingEdgeEdit) {
            return;
          }
          setFlow((current) => ({
            ...current,
            [pendingEdgeEdit.questionId]: {
              ...(current[pendingEdgeEdit.questionId] ?? {
                correct: "end",
                incorrect: "end",
              }),
              [pendingEdgeEdit.branchType]: target,
            },
          }));
          setPendingEdgeEdit(null);
        }}
      />
    </main>
  );
}
