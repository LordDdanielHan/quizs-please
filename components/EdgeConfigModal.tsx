"use client";

import { FlowTarget } from "./quizEditorTypes";
import styles from "@/styles/quiz-editor.module.css";

interface EdgeConfigModalProps {
  open: boolean;
  turnLabel: string;
  branchType: "correct" | "incorrect";
  currentTarget: FlowTarget;
  options: Array<{ id: string; label: string }>;
  onClose: () => void;
  onSave: (target: FlowTarget) => void;
}

export default function EdgeConfigModal({
  open,
  turnLabel,
  branchType,
  currentTarget,
  options,
  onClose,
  onSave,
}: EdgeConfigModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <div className={styles.modalCard} role="dialog" aria-modal="true">
        <h3>Configure {branchType === "correct" ? "Correct" : "Incorrect"} Path</h3>
        <p>
          {turnLabel} {branchType === "correct" ? "correct" : "incorrect"}{" "}
          should go to:
        </p>
        <select
          className={styles.select}
          value={currentTarget}
          onChange={(event) => onSave(event.target.value)}
        >
          <option value="end">End</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <div className={styles.modalActions}>
          <button type="button" className={styles.secondaryButton} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
