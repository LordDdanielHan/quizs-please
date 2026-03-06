"use client";

import styles from "@/styles/quiz-editor.module.css";

interface TypeSwitchModalProps {
  open: boolean;
  nextType?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function TypeSwitchModal({
  open,
  nextType,
  onCancel,
  onConfirm,
}: TypeSwitchModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className={styles.modalBackdrop} role="presentation">
      <div className={styles.modalCard} role="dialog" aria-modal="true">
        <h3>Switch question type?</h3>
        <p>
          Switching to {nextType ? `.${nextType}` : "this type"} will discard current
          answer options. Continue?
        </p>
        <div className={styles.modalActions}>
          <button type="button" className={styles.secondaryButton} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className={styles.primaryButton} onClick={onConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
