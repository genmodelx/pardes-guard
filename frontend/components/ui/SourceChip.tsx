"use client";

import { IconArrowSquareOut, IconLinkSimple, IconSealCheck } from "@/components/icons";
import { useI18n } from "@/lib/i18n";
import type { SourceRef } from "@/lib/types";
import styles from "./SourceChip.module.css";

/**
 * Where a rule, fee or helpline comes from. Tapping it opens the official page.
 * `checked` is the date our team last compared the content with that page; without it the chip
 * says "not checked yet", which is the honest state of draft content.
 */
export function SourceChip({ source, checked }: { source: SourceRef; checked?: string | null }) {
  const { t, date } = useI18n();
  return (
    <a className={styles.chip} href={source.url} target="_blank" rel="noopener noreferrer">
      <IconSealCheck weight={checked ? "fill" : "regular"} size={22} className={checked ? styles.sealOn : styles.sealOff} />
      <span className={styles.text}>
        <span className={styles.title}>
          <span className="visually-hidden">{t("source.label")}: </span>
          <bdi>{source.title}</bdi>
        </span>
        <span className={styles.meta}>{checked ? t("source.checked", { date: date(checked) }) : t("source.notChecked")}</span>
      </span>
      <IconArrowSquareOut weight="bold" size={20} className={styles.out} />
      <span className="visually-hidden">({t("common.newTab")})</span>
    </a>
  );
}

export function SourceList({ sources, checked }: { sources: SourceRef[]; checked?: string | null }) {
  if (!sources.length) return null;
  return (
    <ul className={styles.list}>
      {sources.map((s) => (
        <li key={s.url + s.title}>
          <SourceChip source={s} checked={checked} />
        </li>
      ))}
    </ul>
  );
}

/** The site a button is about to open, written out, so a person sees where they are going before they tap. */
export function WebAddress({ url }: { url: string }) {
  let host = url;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* not a full address: show it as written */
  }
  return (
    <p className={styles.address}>
      <IconLinkSimple size={20} />
      <bdi dir="ltr" lang="en">
        {host}
      </bdi>
    </p>
  );
}
