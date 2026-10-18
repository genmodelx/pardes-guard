"use client";

import { IconCheck, IconHandPalm, IconInfo, IconWarning, IconWarningOctagon } from "@/components/icons";
import { cx } from "@/lib/cx";
import { useI18n } from "@/lib/i18n";
import type { Severity, VerdictLevel } from "@/lib/types";
import styles from "./Verdict.module.css";

/** How serious one warning is: its own shape, colour and word. */
export function SeverityChip({ severity }: { severity: Severity }) {
  const { t } = useI18n();
  const Icon = severity === "high" ? IconWarningOctagon : severity === "medium" ? IconWarning : IconInfo;
  return (
    <span className={cx(styles.severity, styles[severity])}>
      <Icon weight="fill" size={18} />
      <span>{t(`severity.${severity}`)}</span>
    </span>
  );
}

/** The stamp's word and shape in small, for lists of past checks. */
export function VerdictChip({ level }: { level: VerdictLevel }) {
  const { t } = useI18n();
  const Icon = level === "red" ? IconHandPalm : level === "amber" ? IconWarning : IconCheck;
  return (
    <span className={cx(styles.verdict, styles[level])}>
      <Icon weight={level === "green" ? "bold" : "fill"} size={18} />
      <span>{t(`stamp.${level}`)}</span>
    </span>
  );
}
