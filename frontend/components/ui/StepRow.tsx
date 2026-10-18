"use client";

import type { ReactNode } from "react";
import { IconCaretRight } from "@/components/icons";
import { useI18n } from "@/lib/i18n";
import { StatusIcon, type ItemStatus } from "./Chips";
import { LocaleLink } from "./LocaleLink";
import styles from "./StepRow.module.css";

/**
 * One step in a journey stage. The whole row is the tap target and opens the step.
 * `lang` marks a title that is still in English inside another language's page, so it is set in
 * the right type and read with the right voice.
 */
export function StepRow({ href, status, title, meta, lang }: { href: string; status: ItemStatus | "problem"; title: string; meta?: ReactNode; lang?: string }) {
  const { t } = useI18n();
  return (
    <li className={styles.item}>
      <LocaleLink href={href} className={styles.row} data-status={status}>
        <StatusIcon status={status} size={28} />
        <span className="visually-hidden">{t(status === "problem" ? "severity.high" : `status.${status}`)}: </span>
        <span className={styles.text}>
          <span className={styles.title} lang={lang} dir={lang ? "auto" : undefined}>
            {title}
          </span>
          {meta ? <span className={styles.meta}>{meta}</span> : null}
        </span>
        <IconCaretRight weight="bold" size={20} directional className={styles.chevron} />
      </LocaleLink>
    </li>
  );
}

export function StepList({ children }: { children: ReactNode }) {
  return <ul className={styles.list}>{children}</ul>;
}

/** A row in a menu: picture, title, one line of description. Used on More, Help and Home. */
export function MenuRow({ href, icon, title, description, external = false }: { href: string; icon: ReactNode; title: string; description?: string; external?: boolean }) {
  const inner = (
    <>
      <span className={styles.menuIcon}>{icon}</span>
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {description ? <span className={styles.description}>{description}</span> : null}
      </span>
      <IconCaretRight weight="bold" size={20} directional className={styles.chevron} />
    </>
  );
  return (
    <li className={styles.item}>
      {external ? (
        <a href={href} className={styles.row} target="_blank" rel="noopener noreferrer">
          {inner}
        </a>
      ) : (
        <LocaleLink href={href} className={styles.row}>
          {inner}
        </LocaleLink>
      )}
    </li>
  );
}

/** A white sheet that holds MenuRows with hairlines between them. */
export function MenuList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className={styles.menu} aria-label={label}>
      {children}
    </ul>
  );
}
