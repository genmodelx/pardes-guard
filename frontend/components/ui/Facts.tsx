"use client";

import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { useI18n } from "@/lib/i18n";
import styles from "./Facts.module.css";

/** Short facts about a paper or a step: a label with its answer underneath. */
export function FactList({ children }: { children: ReactNode }) {
  return <dl className={styles.list}>{children}</dl>;
}

export function Fact({ icon, label, children }: { icon?: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt className={styles.label}>
        {icon ? <span className={styles.icon}>{icon}</span> : null}
        <span>{label}</span>
      </dt>
      <dd className={cx(styles.value, Boolean(icon) && styles.indented)}>{children}</dd>
    </div>
  );
}

/**
 * Stands where a fact would be when our team has not added it. An empty space would look like
 * "nothing is needed"; this says plainly that we do not know yet.
 */
export function NotYet() {
  const { t } = useI18n();
  return <span className={styles.notYet}>{t("docs.notYet")}</span>;
}

/** Steps that happen in order. Numbered because the order matters. */
export function NumberedSteps({ steps, lang }: { steps: string[]; lang?: string }) {
  return (
    <ol className={styles.steps} lang={lang}>
      {steps.map((step, i) => (
        <li key={i} className={styles.step}>
          <bdi className={styles.n} aria-hidden="true">
            {i + 1}
          </bdi>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** A plain list with a mark before each line (things to bring). */
export function TickList({ items, lang }: { items: string[]; lang?: string }) {
  return (
    <ul className={styles.ticks} lang={lang}>
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
