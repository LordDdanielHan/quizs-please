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
  MatchPair,
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
    typeof input === "string" ? input.replace(/^\./, "") : "multiple-choice-1";
  if (SUPPORTED_TYPES.includes(cleaned as QuestionType)) {
    return cleaned as QuestionType;
  }
  return "multiple-choice-1";
};

const defaultOptions = (): AnswerOption[] => [
  { id: makeId(), text: "", isCorrect: false },
  { id: makeId(), text: "", isCorrect: false },
];

const defaultPairs = (): MatchPair[] => [
  { id: makeId(), left: "", right: "" },
  { id: makeId(), left: "", right: "" },
];

const defaultsForType = (
  type: QuestionType
): Pick<EditorQuestion, "options" | "pairs" | "sampleAnswer"> => {
  if (type === "match") {
    return { options: [], pairs: defaultPairs(), sampleAnswer: "" };
  }
  if (type === "essay") {
    return { options: [], pairs: [], sampleAnswer: "" };
  }
  return { options: defaultOptions(), pairs: [], sampleAnswer: "" };
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
  const item = bit.item;
  if (typeof item === "string") {
    return item;
  }
  const body = bit.body;
  if (typeof body === "string") {
    return body;
  }
  const cardNode = bit.cardNode as Record<string, unknown> | undefined;
  if (cardNode && typeof cardNode.body === "string") {
    return cardNode.body;
  }
  return "";
};

const readOptions = (bit: Record<string, unknown>): AnswerOption[] => {
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
  return normalized.length > 0 ? normalized : defaultOptions();
};

const readPairs = (bit: Record<string, unknown>): MatchPair[] => {
  const pairs = bit.pairs;
  if (!Array.isArray(pairs)) {
    return defaultPairs();
  }
  const normalized = pairs.map((pair) => {
    const record = pair as Record<string, unknown>;
    const rightValues = Array.isArray(record.values)
      ? (record.values as unknown[])
      : [];
    return {
      id: makeId(),
      left: typeof record.key === "string" ? record.key : "",
      right: typeof rightValues[0] === "string" ? (rightValues[0] as string) : "",
    };
  });
  return normalized.length > 0 ? normalized : defaultPairs();
};

const readSampleAnswer = (bit: Record<string, unknown>): string => {
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
      type === "multiple-choice-1" || type === "multiple-response-1"
        ? readOptions(bit)
        : [],
    sampleAnswer: type === "essay" ? readSampleAnswer(bit) : "",
    pairs: type === "match" ? readPairs(bit) : [],
    sourceBit: bit,
  };
};

const serializeQuestion = (question: EditorQuestion, flow: FlowMap) => {
  const nextBit: Record<string, unknown> = { ...question.sourceBit };
  nextBit.id = question.id;
  nextBit.type = question.type;
  nextBit.item = question.body;

  if (question.type === "multiple-choice-1" || question.type === "multiple-response-1") {
    const cleanedOptions = question.options.filter((option) => option.text.trim().length > 0);
    nextBit.responses = cleanedOptions.map((option) => ({ text: option.text.trim() }));
    nextBit.solutions = cleanedOptions
      .filter((option) => option.isCorrect)
      .map((option) => ({ response: option.text.trim(), isExample: false }));
    delete nextBit.pairs;
  }

  if (question.type === "essay") {
    nextBit.responses = [];
    nextBit.solutions = question.sampleAnswer.trim()
      ? [{ response: question.sampleAnswer.trim(), isExample: false }]
      : [];
    delete nextBit.pairs;
  }

  if (question.type === "match") {
    const cleanedPairs = question.pairs.filter(
      (pair) => pair.left.trim().length > 0 || pair.right.trim().length > 0
    );
    nextBit.pairs = cleanedPairs.map((pair) => ({
      key: pair.left.trim(),
      values: [pair.right.trim()],
    }));
    nextBit.responses = [];
    nextBit.solutions = [];
  }

  nextBit.flow = flow[question.id] ?? { correct: "end", incorrect: "end" };
  return nextBit;
};

const emptyQuestion = (): EditorQuestion => ({
  id: makeId(),
  type: "multiple-choice-1",
  body: "",
  options: defaultOptions(),
  sampleAnswer: "",
  pairs: [],
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
                          if (previous.type === "multiple-choice-1") {
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
                  onSampleAnswerChange={(id, value) =>
                    updateQuestion(id, (previous) => ({
                      ...previous,
                      sampleAnswer: value,
                    }))
                  }
                  onPairChange={(id, pairId, side, value) =>
                    updateQuestion(id, (previous) => ({
                      ...previous,
                      pairs: previous.pairs.map((pair) =>
                        pair.id === pairId ? { ...pair, [side]: value } : pair
                      ),
                    }))
                  }
                  onAddPair={(id) =>
                    updateQuestion(id, (previous) => ({
                      ...previous,
                      pairs: [...previous.pairs, { id: makeId(), left: "", right: "" }],
                    }))
                  }
                  onRemovePair={(id, pairId) =>
                    updateQuestion(id, (previous) => ({
                      ...previous,
                      pairs: previous.pairs.filter((pair) => pair.id !== pairId),
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
