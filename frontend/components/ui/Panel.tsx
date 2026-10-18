import { useId, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import styles from "./Panel.module.css";

/** A plain white sheet for a block that belongs together: a prompt with its button, one contact. */
export function Panel({ title, children, tone = "plain" }: { title?: string; children: ReactNode; tone?: "plain" | "danger" }) {
  const id = useId();
  return (
    <section className={cx(styles.panel, tone === "danger" && styles.danger)} aria-labelledby={title ? id : undefined}>
      {title ? (
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}
