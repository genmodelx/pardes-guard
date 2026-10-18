"use client";

import { SourceChip } from "@/components/ui/SourceChip";
import { cx } from "@/lib/cx";
import type { SourceRef } from "@/lib/types";
import styles from "./ChatLog.module.css";

export interface ChatLine {
  who: "you" | "other";
  text: string;
  /** A line under the message, such as "Looked at: the licensed list". */
  note?: string;
  /** Links from the app's own data that the message drew on, each with its checked date. */
  links?: (SourceRef & { checked: string | null })[];
}

/**
 * A conversation: the person's messages on one side, the other side's on the other. New lines are
 * read out by screen readers as they arrive. Text is shown as typed, in its own direction.
 */
export function ChatLog({ lines, you, other, busy }: { lines: ChatLine[]; you: string; other: string; busy?: string | null }) {
  return (
    <ol className={styles.log} role="log" aria-live="polite">
      {lines.map((line, i) => (
        <li key={i} className={cx(styles.line, line.who === "you" ? styles.you : styles.other)}>
          <span className={styles.who}>{line.who === "you" ? you : other}</span>
          <p className={styles.text} dir="auto">
            {line.text}
          </p>
          {line.note ? <p className={styles.note}>{line.note}</p> : null}
          {line.links?.length ? (
            <ul className={styles.links}>
              {line.links.map((l) => (
                <li key={l.url}>
                  <SourceChip source={l} checked={l.checked} />
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
      {busy ? (
        <li className={cx(styles.line, styles.other, styles.busy)}>
          <span className={styles.who}>{other}</span>
          <p className={styles.text}>{busy}</p>
        </li>
      ) : null}
    </ol>
  );
}
