"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { IconX } from "@/components/icons";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { findTerms, type TermId } from "@/lib/terms";
import { Button } from "./Button";
import { ListenButton } from "./ListenButton";
import styles from "./Sheet.module.css";

/**
 * A panel that rises from the bottom of the screen, built on the native <dialog>.
 * The browser handles focus, Escape and the backdrop. It appears without animation.
 */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const { t } = useI18n();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // A tap on the dimmed area outside the panel closes it.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className={styles.panel}>
        <div className={styles.head}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose}>
            <IconX weight="bold" size={20} />
            <span>{t("common.close")}</span>
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.foot}>{footer}</div> : null}
      </div>
    </dialog>
  );
}

/** Asks before anything that cannot be undone. The safe choice is listed second and is not red. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Sheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} busy={busy} data-testid="confirm-yes">
            {confirmLabel}
          </Button>
          <Button variant="secondary" full onClick={onCancel}>
            {t("common.cancel")}
          </Button>
        </>
      }
    >
      {body}
    </Sheet>
  );
}


/**
 * A word that needs explaining (CAS, Protector, attestation). It looks like a dotted link; tapping it
 * opens the meaning in plain words, with Listen. Use it the first time the word appears on a screen.
 */
export function Term({ id, children }: { id: TermId; children?: ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const name = t(`term.${id}` as Key);
  const meaning = t(`term.${id}.d` as Key);
  return (
    <>
      <button type="button" className={styles.term} onClick={() => setOpen(true)} aria-label={t("term.open", { term: name })}>
        {children ?? name}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={name}>
        <p>{meaning}</p>
        <ListenButton text={`${name}. ${meaning}`} />
      </Sheet>
    </>
  );
}

/** The meanings of any known terms in `text`, offered under it: "What these words mean: CAS, Biometrics". */
export function TermList({ text }: { text: string }) {
  const { t } = useI18n();
  const ids = findTerms(text);
  if (!ids.length) return null;
  return (
    <p className={styles.terms}>
      <span className={styles.termsLabel}>{t("term.words")}</span>
      {ids.map((id) => (
        <Term key={id} id={id} />
      ))}
    </p>
  );
}
