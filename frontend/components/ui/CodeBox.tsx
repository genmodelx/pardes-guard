"use client";

import { useState } from "react";
import { IconCopy } from "@/components/icons";
import { useI18n } from "@/lib/i18n";
import { Button } from "./Button";
import styles from "./CodeBox.module.css";

/** Split a code into groups of four so it can be read out or typed without losing the place. */
export function groupCode(code: string, size = 4): string[] {
  const out: string[] = [];
  for (let i = 0; i < code.length; i += size) out.push(code.slice(i, i + size));
  return out;
}

/**
 * A code a person must read out or type: a family share code or a case reference.
 * The only place the mono face is used. Always left to right, also in Urdu.
 */
export function CodeBox({ label, code }: { label: string; code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* no clipboard: the code is on screen to read or type */
    }
  };
  return (
    <div className={styles.box}>
      <p className={styles.label}>{label}</p>
      <p className={styles.code}>
        {/* Screen readers get the code one character at a time; the grouped version is for the eye. */}
        <span className="visually-hidden" lang="en">
          {code.split("").join(" ")}
        </span>
        <bdi dir="ltr" lang="en" className="mono" aria-hidden="true">
          {groupCode(code).map((g, i) => (
            <span key={i} className={styles.group}>
              {g}
            </span>
          ))}
        </bdi>
      </p>
      <Button variant="secondary" compact full={false} icon={<IconCopy size={20} />} onClick={copy}>
        {copied ? t("common.copied") : t("common.copy")}
      </Button>
      <span className="visually-hidden" role="status">
        {copied ? t("common.copied") : ""}
      </span>
    </div>
  );
}
