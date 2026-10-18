"use client";

import { useId, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import styles from "./PassportPage.module.css";

/**
 * One journey stage, drawn as a passport page: a security-print strip along the top edge, a page
 * number in the corner, and a place where the DONE stamp lands when every step is finished.
 */
export function PassportPage({
  page,
  title,
  done,
  total,
  stamp,
  note,
  children,
}: {
  /** Page number, starting at 1. */
  page: number;
  title: string;
  done: number;
  total: number;
  /** A <Stamp level="done"> once the stage is complete. Until then an empty dashed ring shows where it goes. */
  stamp?: ReactNode;
  /** A badge or short line about the whole page, shown under its title (for example: this page is a draft). */
  note?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <section className={styles.page} aria-labelledby={id}>
      <div className={styles.strip} aria-hidden="true" />
      <header className={styles.head}>
        <div className={styles.heading}>
          <h2 id={id}>{title}</h2>
          {total > 0 ? <p className={styles.count}>{t("journey.stageCount", { done, total })}</p> : null}
        </div>
        <div className={styles.slot}>{stamp ?? <span className={styles.empty} aria-hidden="true" />}</div>
      </header>
      {note ? <div className={styles.note}>{note}</div> : null}
      <div className={styles.body}>{children}</div>
      <p className={styles.number}>
        <span className="visually-hidden">{t("journey.page", { n: page })}</span>
        <bdi aria-hidden="true">{page}</bdi>
      </p>
    </section>
  );
}
