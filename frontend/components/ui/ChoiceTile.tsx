"use client";

import { createContext, useContext, useId, useMemo, type ReactNode } from "react";
import { IconCaretRight, IconCheck } from "@/components/icons";
import { cx } from "@/lib/cx";
import { LocaleLink } from "./LocaleLink";
import styles from "./ChoiceTile.module.css";

interface TileContent {
  /** A large icon element (48px, duotone). It is the picture; the label is still required. */
  picture: ReactNode;
  title: string;
  description?: string;
  /** Optional chips or badges under the text. */
  meta?: ReactNode;
}

// The group gives its tiles one shared radio name, so two groups on a page can never interfere.
const GroupName = createContext<{ name: string; dense: boolean }>({ name: "choice", dense: false });

/** One answer in a question. Use inside ChoiceGroup. Whole tile is the tap target. */
export function ChoiceTile({
  value,
  checked,
  onChange,
  picture,
  title,
  description,
  meta,
  lang,
}: TileContent & { value: string; checked: boolean; onChange: (value: string) => void; lang?: string }) {
  const { name, dense } = useContext(GroupName);
  return (
    <label className={cx(styles.tile, dense && styles.small)}>
      <input className={styles.input} type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} />
      <span className={styles.box}>
        <span className={styles.picture}>{picture}</span>
        <span className={styles.text} lang={lang}>
          <span className={styles.title}>{title}</span>
          {description ? <span className={styles.description}>{description}</span> : null}
          {meta ? <span className={styles.meta}>{meta}</span> : null}
        </span>
        <span className={styles.mark} aria-hidden="true">
          <IconCheck weight="bold" size={18} />
        </span>
      </span>
    </label>
  );
}

/**
 * Groups tiles into one question for screen readers. `legend` is the question (usually the page h1).
 * `dense` is for short one-word answers (a step's status): smaller tiles, two to a row on every screen.
 */
export function ChoiceGroup({
  legend,
  legendId,
  children,
  columns = 1,
  dense = false,
}: {
  legend?: string;
  legendId?: string;
  children: ReactNode;
  columns?: 1 | 2;
  dense?: boolean;
}) {
  const name = useId();
  const value = useMemo(() => ({ name, dense }), [name, dense]);
  return (
    <GroupName.Provider value={value}>
      <div role="radiogroup" aria-label={legendId ? undefined : legend} aria-labelledby={legendId} className={cx(styles.group, columns === 2 && styles.two, dense && styles.dense)}>
        {children}
      </div>
    </GroupName.Provider>
  );
}

/** The same tile as a link, for picture menus (Home's other actions, the Help screen). */
export function LinkTile({ href, picture, title, description, meta }: TileContent & { href: string }) {
  return (
    <LocaleLink href={href} className={cx(styles.tile, styles.link)}>
      <span className={styles.box}>
        <span className={styles.picture}>{picture}</span>
        <span className={styles.text}>
          <span className={styles.title}>{title}</span>
          {description ? <span className={styles.description}>{description}</span> : null}
          {meta ? <span className={styles.meta}>{meta}</span> : null}
        </span>
        <IconCaretRight weight="bold" size={20} directional className={styles.chevron} />
      </span>
    </LocaleLink>
  );
}
