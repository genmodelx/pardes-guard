"use client";

import { useId, type ChangeEvent, type ReactNode } from "react";
import { IconCaretDown, IconMicrophone, IconStop, IconWarning } from "@/components/icons";
import { cx } from "@/lib/cx";
import { useI18n } from "@/lib/i18n";
import { useDictation } from "@/lib/speech";
import styles from "./Field.module.css";

interface FieldShell {
  label: string;
  /** One short line of help under the label. */
  hint?: string;
  /** Says what is wrong and what to do. Shown with a warning shape, not just red. */
  error?: string | null;
  optional?: boolean;
}

function Shell({ id, label, hint, error, optional, children }: FieldShell & { id: string; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className={cx(styles.field, error && styles.invalid)}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {optional ? <span className={styles.optional}> ({t("common.optional")})</span> : null}
      </label>
      {hint ? (
        <p className={styles.hint} id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p className={styles.error} id={`${id}-error`} role="alert">
          <IconWarning weight="fill" size={20} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string | null) =>
  [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;

/** The Speak button beside a text input. Hidden when the phone has no speech input. */
function Mic({ lang, onText, inputId }: { lang: string; onText: (text: string) => void; inputId: string }) {
  const { t } = useI18n();
  const d = useDictation(lang, onText);
  if (!d.available) return null;
  const message = d.error === "blocked" ? t("voice.denied") : d.error === "nothing-heard" ? t("voice.nothingHeard") : d.error === "failed" ? t("voice.failed") : null;
  return (
    <>
      <button
        type="button"
        className={cx(styles.mic, d.listening && styles.micOn)}
        onClick={d.listening ? d.stop : d.start}
        aria-pressed={d.listening}
        aria-controls={inputId}
        data-testid="mic"
      >
        {d.listening ? <IconStop weight="fill" size={22} /> : <IconMicrophone size={22} />}
        <span>{d.listening ? t("common.listening") : t("common.speak")}</span>
      </button>
      {message ? (
        <p className={styles.micNote} role="status">
          {message}
        </p>
      ) : null}
    </>
  );
}

export interface TextInputProps extends FieldShell {
  value: string;
  onChange: (value: string) => void;
  /** Text typed here is in this language; also the language the Speak button listens for. */
  lang?: string;
  type?: "text" | "tel" | "email" | "search" | "date" | "month";
  inputMode?: "text" | "numeric" | "decimal" | "tel" | "email" | "search";
  placeholder?: string;
  autoComplete?: string;
  /** Show the value left to right even in Urdu: phone numbers, codes, licence numbers. */
  ltr?: boolean;
  /** Voice input. On by default for free text; turn off for numbers and dates. */
  mic?: boolean;
  maxLength?: number;
  name?: string;
}

export function TextInput({ value, onChange, lang, type = "text", inputMode, placeholder, autoComplete, ltr, mic = true, maxLength, name, ...shell }: TextInputProps) {
  const { locale } = useI18n();
  const id = useId();
  const speakLang = lang ?? locale;
  return (
    <Shell id={id} {...shell}>
      <div className={styles.row}>
        <input
          id={id}
          name={name}
          className={cx(styles.input, ltr && styles.ltr)}
          type={type}
          inputMode={inputMode}
          dir={ltr ? "ltr" : undefined}
          value={value}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete ?? "off"}
          maxLength={maxLength}
          aria-invalid={shell.error ? true : undefined}
          aria-describedby={describedBy(id, shell.hint, shell.error)}
        />
        {mic && type === "text" ? <Mic lang={speakLang} inputId={id} onText={(text) => onChange(value ? `${value} ${text}` : text)} /> : null}
      </div>
    </Shell>
  );
}

export interface TextAreaProps extends FieldShell {
  value: string;
  onChange: (value: string) => void;
  lang?: string;
  rows?: number;
  placeholder?: string;
  mic?: boolean;
  maxLength?: number;
  /** "auto" for text that may be in another language than the page (a letter in English on an Urdu page). */
  dir?: "auto" | "ltr" | "rtl";
  className?: string;
}

export function TextArea({ value, onChange, lang, rows = 4, placeholder, mic = true, maxLength, dir, className, ...shell }: TextAreaProps) {
  const { locale } = useI18n();
  const id = useId();
  return (
    <Shell id={id} {...shell}>
      <textarea
        id={id}
        className={cx(styles.input, styles.area, className)}
        rows={rows}
        dir={dir}
        lang={lang}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        aria-invalid={shell.error ? true : undefined}
        aria-describedby={describedBy(id, shell.hint, shell.error)}
      />
      {mic ? (
        <div className={styles.under}>
          <Mic lang={lang ?? locale} inputId={id} onText={(text) => onChange(value ? `${value} ${text}` : text)} />
        </div>
      ) : null}
    </Shell>
  );
}

export interface SelectProps extends FieldShell {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  /** Shown as the first, empty choice. */
  placeholder?: string;
}

export function Select({ value, onChange, options, placeholder, ...shell }: SelectProps) {
  const id = useId();
  return (
    <Shell id={id} {...shell}>
      <div className={styles.selectWrap}>
        <select
          id={id}
          className={cx(styles.input, styles.select)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={shell.error ? true : undefined}
          aria-describedby={describedBy(id, shell.hint, shell.error)}
        >
          {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <IconCaretDown weight="bold" size={20} className={styles.caret} />
      </div>
    </Shell>
  );
}
