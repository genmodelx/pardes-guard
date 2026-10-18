"use client";

import type { ReactNode } from "react";
import { IconCaretDown } from "@/components/icons";
import { StatusIcon, type ItemStatus } from "./Chips";
import styles from "./ProgressMeter.module.css";

/**
 * Journey progress as one bar and one sentence, with the reasons behind the number one tap away.
 * `value` is 0 to 100.
 */
export function ProgressMeter({ value, label, summary, whyLabel, reasons }: { value: number; label: string; summary: string; whyLabel?: string; reasons?: ReactNode[] }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={styles.meter}>
      <div className={styles.bar} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={summary}>
        <div className={styles.fill} style={{ inlineSize: `${pct}%` }} />
      </div>
      <p className={styles.summary}>{summary}</p>
      {whyLabel && reasons && reasons.length ? (
        <details className={styles.why}>
          <summary className={styles.whyButton}>
            <span>{whyLabel}</span>
            <IconCaretDown weight="bold" size={18} className={styles.caret} />
          </summary>
          <ul className={styles.reasons}>
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** The stages of a journey as a row of status shapes: a glanceable picture of where you are. */
export function StageDots({ stages }: { stages: { id: string; label: string; status: ItemStatus }[] }) {
  return (
    <ol className={styles.dots}>
      {stages.map((s) => (
        <li key={s.id} className={styles.dot}>
          <StatusIcon status={s.status} size={26} />
          <span className="visually-hidden">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}
