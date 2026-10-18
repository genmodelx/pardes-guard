"use client";

import { useEffect, type CSSProperties } from "react";
import { IconCheck, IconHandPalm, IconWarning } from "@/components/icons";
import { cx } from "@/lib/cx";
import styles from "./Stamp.module.css";

export type StampLevel = "red" | "amber" | "green" | "done";

const TILT: Record<StampLevel, number> = { red: -6, amber: -3, green: 4, done: -5 };

/** A small stable number from a string, so each journey stage always gets the same tilt and ink. */
export function stableHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function Frame({ level }: { level: StampLevel }) {
  if (level === "done") {
    return (
      <svg className={styles.frame} viewBox="0 0 132 132" aria-hidden="true" focusable="false">
        <circle cx="66" cy="66" r="61" fill="none" stroke="currentColor" strokeWidth="5" />
        <circle cx="66" cy="66" r="51.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M17 51.5h98M17 80.5h98" fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
    );
  }
  return (
    <svg className={styles.frame} viewBox="0 0 220 132" aria-hidden="true" focusable="false">
      {level === "red" ? (
        <>
          <polygon points="27,3 193,3 217,27 217,105 193,129 27,129 3,105 3,27" fill="none" stroke="currentColor" strokeWidth="5" strokeLinejoin="miter" />
          <polygon points="30.5,11.5 189.5,11.5 208.5,30.5 208.5,101.5 189.5,120.5 30.5,120.5 11.5,101.5 11.5,30.5" fill="none" stroke="currentColor" strokeWidth="2" />
        </>
      ) : null}
      {level === "amber" ? (
        <>
          <path d="M22 3H198a19 19 0 0 0 19 19V110a19 19 0 0 0 -19 19H22a19 19 0 0 0 -19 -19V22a19 19 0 0 0 19 -19Z" fill="none" stroke="currentColor" strokeWidth="5" />
          <path d="M27 11.5H193a15.5 15.5 0 0 0 15.5 15.5V105a15.5 15.5 0 0 0 -15.5 15.5H27a15.5 15.5 0 0 0 -15.5 -15.5V27a15.5 15.5 0 0 0 15.5 -15.5Z" fill="none" stroke="currentColor" strokeWidth="2" />
        </>
      ) : null}
      {level === "green" ? (
        <>
          <rect x="2.5" y="2.5" width="215" height="127" rx="63.5" fill="none" stroke="currentColor" strokeWidth="5" />
          <rect x="11.5" y="11.5" width="197" height="109" rx="54.5" fill="none" stroke="currentColor" strokeWidth="2" />
        </>
      ) : null}
    </svg>
  );
}

export interface StampProps {
  level: StampLevel;
  /** The big word: STOP, CHECK, LOOKS OK, DONE. Already translated. */
  word: string;
  /** The small second line: the plain meaning, or the date for a finished stage. */
  line?: string;
  /** What a screen reader says. Give the full sentence, for example "Stop. Do not pay yet." */
  label: string;
  /** Play the 300ms press once. Use only when a result first appears. */
  press?: boolean;
  /** Any stable text (a stage or check id). Fixes this stamp's tilt and ink pattern. */
  seed?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** The ink stamp: the one loud element in the product. See DESIGN.md section 6. */
export function Stamp({ level, word, line, label, press = false, seed, size = "md", className }: StampProps) {
  const hash = seed ? stableHash(seed) : 0;
  const tilt = level === "done" && seed ? (hash % 17) - 8 : TILT[level];
  const ink = (hash % 3) + 1;
  // Short words (STOP) are set large; longer ones (LOOKS OK) step down so they stay inside the frame.
  const letters = [...word].length;
  const fit = letters <= 5 ? styles.fitShort : letters <= 9 ? styles.fitMedium : styles.fitLong;

  useEffect(() => {
    if (!press) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // One short buzz as the stamp lands (70% of the 300ms press). Not every phone supports this.
    const timer = window.setTimeout(() => {
      try {
        navigator.vibrate?.(35);
      } catch {
        /* vibration is a nicety */
      }
    }, 210);
    return () => window.clearTimeout(timer);
  }, [press]);

  return (
    <div
      role="img"
      aria-label={label}
      className={cx(styles.stamp, styles[level], styles[size], fit, press && styles.press, className)}
      style={{ "--tilt": `${tilt}deg`, filter: `url(#pg-ink-${ink})` } as CSSProperties}
      data-level={level}
    >
      <Frame level={level} />
      <div className={styles.body} aria-hidden="true">
        {level === "done" ? (
          <>
            <span className={styles.word}>{word}</span>
            {line ? (
              <bdi dir="ltr" lang="en" className={styles.date}>
                {line}
              </bdi>
            ) : null}
            <IconCheck weight="bold" className={styles.tick} />
          </>
        ) : (
          <>
            {level === "red" ? <IconHandPalm weight="fill" className={styles.icon} /> : null}
            {level === "amber" ? <IconWarning weight="fill" className={styles.icon} /> : null}
            {level === "green" ? <IconCheck weight="bold" className={styles.icon} /> : null}
            <span className={styles.word}>{word}</span>
            {line ? <span className={styles.line}>{line}</span> : null}
          </>
        )}
      </div>
    </div>
  );
}

/** The ink texture filters. Rendered once per page by the locale layout. */
export function InkFilters() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute", inlineSize: 0, blockSize: 0 }}>
      <defs>
        {[3, 17, 29].map((seed, i) => (
          <filter key={seed} id={`pg-ink-${i + 1}`} x="-6%" y="-6%" width="112%" height="112%" colorInterpolationFilters="sRGB">
            {/* Rough edges, as rubber never prints a clean line. */}
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed={seed} result="warp" />
            <feDisplacementMap in="SourceGraphic" in2="warp" scale="1.5" xChannelSelector="R" yChannelSelector="G" result="rough" />
            {/* Fine specks where the ink did not take. */}
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="1" seed={seed + 4} result="grain" />
            <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -9 6.9" result="specks" />
            <feComposite in="rough" in2="specks" operator="in" result="inked" />
            {/* Uneven pressure across the stamp. */}
            <feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="1" seed={seed + 9} result="press" />
            <feColorMatrix in="press" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.2 2.25" result="pressure" />
            <feComposite in="inked" in2="pressure" operator="in" />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
