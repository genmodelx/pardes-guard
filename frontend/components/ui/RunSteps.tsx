"use client";

import { StatusIcon } from "./Chips";
import styles from "./RunSteps.module.css";

export interface RunStep {
  id: string;
  label: string;
  state: "todo" | "doing" | "done";
}

/**
 * What is happening, in plain words, while a check runs. Each step has its shape: empty ring to
 * come, half ring now, filled tick done. The current step is announced to screen readers.
 */
export function RunSteps({ steps }: { steps: RunStep[] }) {
  const current = steps.find((s) => s.state === "doing");
  return (
    <>
      <ol className={styles.list}>
        {steps.map((s) => (
          <li key={s.id} className={styles.step} data-state={s.state}>
            <StatusIcon status={s.state} size={28} />
            <span>{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="visually-hidden" role="status" aria-live="polite">
        {current?.label ?? ""}
      </p>
    </>
  );
}
