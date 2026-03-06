"use client";

import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { EditorQuestion, QuestionType, SUPPORTED_TYPES } from "./quizEditorTypes";
import styles from "@/styles/quiz-editor.module.css";

interface QuestionCardProps {
  question: EditorQuestion;
  index: number;
  isActive: boolean;
  onSelect: (id: string) => void;
  onBodyChange: (id: string, value: string) => void;
  onTypeChange: (id: string, nextType: QuestionType) => void;
  onOptionTextChange: (id: string, optionId: string, value: string) => void;
  onOptionCorrectChange: (id: string, optionId: string, checked: boolean) => void;
  onAddOption: (id: string) => void;
  onRemoveOption: (id: string, optionId: string) => void;
  onSampleAnswerChange: (id: string, value: string) => void;
  onPairChange: (
    id: string,
    pairId: string,
    side: "left" | "right",
    value: string
  ) => void;
  onAddPair: (id: string) => void;
  onRemovePair: (id: string, pairId: string) => void;
}

const typeLabel = (type: QuestionType): string => `.${type}`;

export default function QuestionCard({
  question,
  index,
  isActive,
  onSelect,
  onBodyChange,
  onTypeChange,
  onOptionTextChange,
  onOptionCorrectChange,
  onAddOption,
  onRemoveOption,
  onSampleAnswerChange,
  onPairChange,
  onAddPair,
  onRemovePair,
}: QuestionCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: question.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article ref={setNodeRef} style={style} className={styles.card}>
      <div className={styles.cardTop}>
        <button
          type="button"
          className={styles.dragHandle}
          aria-label={`Drag question ${index + 1}`}
          {...attributes}
          {...listeners}
        >
          ::
        </button>
        <div className={styles.cardHeading}>
          <strong>Q{index + 1}</strong>
          <span className={styles.typeBadge}>{typeLabel(question.type)}</span>
        </div>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={() => onSelect(question.id)}
        >
          {isActive ? "Collapse" : "Edit"}
        </button>
      </div>

      <label className={styles.label}>
        Question Body
        <textarea
          className={styles.textarea}
          value={question.body}
          onChange={(event) => onBodyChange(question.id, event.target.value)}
          rows={2}
        />
      </label>

      <label className={styles.label}>
        Question Type
        <select
          className={styles.select}
          value={question.type}
          onChange={(event) =>
            onTypeChange(question.id, event.target.value as QuestionType)
          }
        >
          {SUPPORTED_TYPES.map((type) => (
            <option key={type} value={type}>
              {typeLabel(type)}
            </option>
          ))}
        </select>
      </label>

      {isActive && (
        <div className={styles.expandedArea}>
          {(question.type === "multiple-choice-1" ||
            question.type === "multiple-response-1") && (
            <div className={styles.group}>
              <h4 className={styles.groupTitle}>Answer Options</h4>
              {question.options.map((option) => (
                <div key={option.id} className={styles.optionRow}>
                  <input
                    className={styles.inlineInput}
                    type="text"
                    value={option.text}
                    placeholder="Option text"
                    onChange={(event) =>
                      onOptionTextChange(question.id, option.id, event.target.value)
                    }
                  />
                  <label className={styles.inlineCheck}>
                    {question.type === "multiple-choice-1" ? "Correct" : "Correct?"}
                    <input
                      type={question.type === "multiple-choice-1" ? "radio" : "checkbox"}
                      name={`correct-${question.id}`}
                      checked={option.isCorrect}
                      onChange={(event) =>
                        onOptionCorrectChange(
                          question.id,
                          option.id,
                          event.target.checked
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={() => onRemoveOption(question.id, option.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => onAddOption(question.id)}
              >
                Add Option
              </button>
            </div>
          )}

          {question.type === "essay" && (
            <label className={styles.label}>
              Sample Answer (Optional)
              <textarea
                className={styles.textarea}
                value={question.sampleAnswer}
                rows={3}
                onChange={(event) =>
                  onSampleAnswerChange(question.id, event.target.value)
                }
              />
            </label>
          )}

          {question.type === "match" && (
            <div className={styles.group}>
              <h4 className={styles.groupTitle}>Match Pairs</h4>
              {question.pairs.map((pair) => (
                <div key={pair.id} className={styles.pairRow}>
                  <input
                    className={styles.inlineInput}
                    type="text"
                    value={pair.left}
                    placeholder="Left item"
                    onChange={(event) =>
                      onPairChange(question.id, pair.id, "left", event.target.value)
                    }
                  />
                  <input
                    className={styles.inlineInput}
                    type="text"
                    value={pair.right}
                    placeholder="Right item"
                    onChange={(event) =>
                      onPairChange(question.id, pair.id, "right", event.target.value)
                    }
                  />
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={() => onRemovePair(question.id, pair.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => onAddPair(question.id)}
              >
                Add Pair
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

