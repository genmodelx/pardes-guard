"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { LocaleLink } from "./LocaleLink";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps {
  variant?: Variant;
  /** An icon element shown before the label. Buttons always keep their text label. */
  icon?: ReactNode;
  /** Stretch to the full width of the column. Default: true for primary and danger. */
  full?: boolean;
  /** Smaller height (52px) for secondary actions inside rows. */
  compact?: boolean;
  children: ReactNode;
  className?: string;

  /** With href the button is a link: an app path ("/journey"), or any URL when `external` is set. */
  href?: string;
  external?: boolean;
  /** For app links: fetch the next screen before the tap. Default: on for the primary button only. */
  prefetch?: boolean;

  type?: "button" | "submit";
  disabled?: boolean;
  /** Shows the button as working and blocks a second tap. */
  busy?: boolean;
  onClick?: MouseEventHandler<HTMLElement>;
  id?: string;
  "aria-describedby"?: string;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  "aria-pressed"?: boolean;
  "data-testid"?: string;
}

/** One primary Button per screen. Labels say what happens ("Check this paper"), never "Submit". */
export function Button({
  variant = "primary",
  icon,
  full,
  compact,
  children,
  className,
  href,
  external,
  prefetch,
  type = "button",
  disabled,
  busy,
  onClick,
  ...aria
}: ButtonProps) {
  const wide = full ?? (variant === "primary" || variant === "danger");
  const classes = cx(styles.button, styles[variant], wide && styles.full, compact && styles.compact, className);
  const content = (
    <>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span className={styles.label}>{children}</span>
    </>
  );

  if (href !== undefined && external) {
    return (
      <a {...aria} className={classes} href={href} target="_blank" rel="noopener noreferrer" onClick={onClick}>
        {content}
      </a>
    );
  }
  if (href !== undefined) {
    return (
      <LocaleLink {...aria} className={classes} href={href} onClick={onClick} prefetch={prefetch ?? variant === "primary"}>
        {content}
      </LocaleLink>
    );
  }
  return (
    <button {...aria} type={type} className={classes} disabled={disabled || busy} aria-busy={busy || undefined} onClick={onClick}>
      {content}
    </button>
  );
}
