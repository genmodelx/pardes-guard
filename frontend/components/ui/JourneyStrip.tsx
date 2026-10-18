"use client";

import { IconCaretRight } from "@/components/icons";
import type { ItemStatus } from "./Chips";
import { LocaleLink } from "./LocaleLink";
import { StageDots } from "./ProgressMeter";
import styles from "./JourneyStrip.module.css";

/** Home's one-line picture of the journey: a shape per stage and the count. The whole strip opens the journey. */
export function JourneyStrip({ href, stages, summary, action }: { href: string; stages: { id: string; label: string; status: ItemStatus }[]; summary: string; action: string }) {
  return (
    <LocaleLink href={href} className={styles.strip} data-testid="journey-strip">
      <span className={styles.text}>
        <span className={styles.summary}>{summary}</span>
        <StageDots stages={stages} />
      </span>
      <span className={styles.action}>
        <span>{action}</span>
        <IconCaretRight weight="bold" size={20} directional />
      </span>
    </LocaleLink>
  );
}
