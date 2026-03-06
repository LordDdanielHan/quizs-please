"use client";

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
  onSampleSolutionChange: (id: string, value: string) => void;
  onInstructionChange: (id: string, value: string) => void;
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
  onSampleSolutionChange,
  onInstructionChange,
}: QuestionCardProps) {
  return (
    <article className={styles.card}>
      <div className={styles.cardTop}>
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
        <div key={question.type} className={styles.expandedArea}>
          {question.type === "multiple-choice" && (
            <div className={styles.group}>
              <h4 className={styles.groupTitle}>Choices</h4>
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
                    Correct
                    <input
                      type="radio"
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

          {question.type === "true-false-1" && (
            <div className={styles.group}>
              <h4 className={styles.groupTitle}>True / False</h4>
              {question.options.map((option) => (
                <label key={option.id} className={styles.inlineCheck}>
                  {option.text}
                  <input
                    type="radio"
                    name={`tf-${question.id}`}
                    checked={option.isCorrect}
                    onChange={(event) =>
                      onOptionCorrectChange(question.id, option.id, event.target.checked)
                    }
                  />
                </label>
              ))}
            </div>
          )}

          {(question.type === "question-1" || question.type === "essay" || question.type === "sequence") && (
            <label className={styles.label}>
              Instruction / Hint
              <textarea
                className={styles.textarea}
                value={question.instruction}
                rows={2}
                onChange={(event) => onInstructionChange(question.id, event.target.value)}
              />
            </label>
          )}

          {(question.type === "question-1" || question.type === "essay") && (
            <label className={styles.label}>
              Sample Solution (Optional)
              <textarea
                className={styles.textarea}
                value={question.sampleSolution}
                rows={3}
                onChange={(event) =>
                  onSampleSolutionChange(question.id, event.target.value)
                }
              />
            </label>
          )}

          {question.type === "sequence" && (
            <div className={styles.group}>
              <h4 className={styles.groupTitle}>Sequence Steps</h4>
              {question.options.map((option) => (
                <div key={option.id} className={styles.optionRow}>
                  <input
                    className={styles.inlineInput}
                    type="text"
                    value={option.text}
                    placeholder="Step text"
                    onChange={(event) =>
                      onOptionTextChange(question.id, option.id, event.target.value)
                    }
                  />
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
                Add Step
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
