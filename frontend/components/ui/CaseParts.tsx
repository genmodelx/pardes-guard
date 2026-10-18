"use client";

import { IconCheckCircle, IconCircle, IconCircleHalf, IconEnvelopeSimple, IconHourglass, IconMinusCircle, IconPaperPlaneTilt, IconWarningOctagon, IconXCircle } from "@/components/icons";
import { cx } from "@/lib/cx";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import type { Case, CaseStatus, LadderStep, StepStatus } from "@/lib/types";
import { Chip } from "./Chips";
import styles from "./CaseParts.module.css";

const CASE_LOOK: Record<CaseStatus, { tone: "neutral" | "amber" | "ok" | "green"; Icon: typeof IconCircle }> = {
  open: { tone: "neutral", Icon: IconCircle },
  escalating: { tone: "green", Icon: IconCircleHalf },
  awaiting_approval: { tone: "amber", Icon: IconHourglass },
  resolved: { tone: "ok", Icon: IconCheckCircle },
  closed: { tone: "neutral", Icon: IconMinusCircle },
};

/** Where a case stands. Each status has its own shape, so colour is never the only sign. */
export function CaseStatusChip({ status }: { status: CaseStatus }) {
  const { t } = useI18n();
  const { tone, Icon } = CASE_LOOK[status];
  return (
    <Chip tone={tone} icon={<Icon weight="fill" size={18} />}>
      {t(`case.status.${status}` as Key)}
    </Chip>
  );
}

/** The emergency mark on a case. */
export function EmergencyChip() {
  const { t } = useI18n();
  return (
    <Chip tone="red" icon={<IconWarningOctagon weight="fill" size={18} />}>
      {t("case.kind.emergency")}
    </Chip>
  );
}

const STEP_ICON: Record<StepStatus, typeof IconCircle> = {
  scheduled: IconCircle,
  awaiting_approval: IconEnvelopeSimple,
  approved: IconCheckCircle,
  sent: IconPaperPlaneTilt,
  declined: IconXCircle,
  skipped: IconMinusCircle,
};

/** The step's name in the reader's language. */
export function useStepName(): (step: LadderStep) => string {
  const { t } = useI18n();
  return (step) => t(`step.${step.action}` as Key);
}

/** The escalation ladder, in order. The step waiting for the person stands out. */
export function Ladder({ c }: { c: Case }) {
  const { t, date } = useI18n();
  const name = useStepName();
  return (
    <ol className={styles.ladder}>
      {c.ladder.map((step) => {
        const Icon = STEP_ICON[step.status];
        const status =
          step.status === "scheduled"
            ? t("stepstatus.scheduled", { date: date(step.due_at) })
            : step.status === "sent"
              ? t("stepstatus.sent", { date: date(step.sent_at) })
              : t(`stepstatus.${step.status}` as Key);
        return (
          <li key={step.index} className={cx(styles.step, styles[`s-${step.status}`])} data-status={step.status}>
            <Icon weight={step.status === "scheduled" ? "regular" : "fill"} size={26} className={styles.stepIcon} />
            <span className={styles.stepText}>
              <span className={styles.stepName}>{name(step)}</span>
              <span className={styles.stepStatus}>{status}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
