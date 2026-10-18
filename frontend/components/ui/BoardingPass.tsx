"use client";

import { useId, type ReactNode } from "react";
import { IconAirplane } from "@/components/icons";
import { useI18n } from "@/lib/i18n";
import styles from "./BoardingPass.module.css";

/**
 * The "your next step" card on Home, shaped like a boarding pass: where from, where to, a tear line
 * with notches, then the one thing to do now with its one button.
 */
export function BoardingPass({
  from,
  to,
  route,
  kicker,
  title,
  meta,
  action,
  children,
}: {
  from: string;
  /** Destination country name, or null when it is not chosen yet. */
  to: string | null;
  /** The visa route name, shown under the countries. */
  route?: string | null;
  /** The small line above the step title: "Your next step". */
  kicker: string;
  title: string;
  /** Chips and the step counter. */
  meta?: ReactNode;
  /** The one primary Button. */
  action: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <section className={styles.pass} aria-labelledby={id}>
      <div className={styles.top}>
        <div className={styles.route}>
          <p className={styles.place}>
            <span className={styles.placeLabel}>{t("pass.from")}</span>
            <span className={styles.placeName}>{from}</span>
          </p>
          <span className={styles.flight} aria-hidden="true">
            <span className={styles.dots} />
            <IconAirplane weight="fill" size={26} className={styles.plane} />
            <span className={styles.dots} />
          </span>
          <p className={`${styles.place} ${styles.end}`}>
            <span className={styles.placeLabel}>{t("pass.to")}</span>
            <span className={styles.placeName}>{to ?? t("pass.toUnknown")}</span>
          </p>
        </div>
        {route ? <p className={styles.routeName}>{route}</p> : null}
      </div>
      <div className={styles.tear} aria-hidden="true" />
      <div className={styles.step}>
        <p className={styles.kicker}>{kicker}</p>
        <h2 id={id} className={styles.title}>
          {title}
        </h2>
        {children}
        {meta ? <div className={styles.meta}>{meta}</div> : null}
        <div className={styles.action}>{action}</div>
      </div>
    </section>
  );
}
