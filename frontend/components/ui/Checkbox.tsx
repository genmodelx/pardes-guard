"use client";

import { useId, type ReactNode } from "react";
import { IconCheck } from "@/components/icons";
import styles from "./Checkbox.module.css";

/** A yes-or-no question as one big row. The whole row is the tap target. */
export function Checkbox({ checked, onChange, label, hint, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: ReactNode; hint?: string; disabled?: boolean }) {
  const id = useId();
  return (
    <label className={styles.row} htmlFor={id} data-disabled={disabled || undefined}>
      <input id={id} className={styles.input} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} />
      <span className={styles.box} aria-hidden="true">
        <IconCheck weight="bold" size={18} />
      </span>
      <span className={styles.text}>
        <span className={styles.label}>{label}</span>
        {hint ? (
          <span className={styles.hint} id={`${id}-hint`}>
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}
