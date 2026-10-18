"use client";

import type { ReactNode } from "react";
import {
  IconBank,
  IconBuildings,
  IconCheckCircle,
  IconCircle,
  IconCircleHalf,
  IconFlask,
  IconGraduationCap,
  IconHandshake,
  IconMinusCircle,
  IconPencilSimpleLine,
  IconRobot,
  IconSealCheck,
  IconTranslate,
  IconUser,
  IconWarning,
} from "@/components/icons";
import { cx } from "@/lib/cx";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import styles from "./Chips.module.css";

type Tone = "neutral" | "green" | "ok" | "amber" | "red";

/** A small label with an icon. Chips describe; they are not buttons. */
export function Chip({ tone = "neutral", icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cx(styles.chip, styles[tone], className)}>
      {icon ? <span className={styles.icon}>{icon}</span> : null}
      <span>{children}</span>
    </span>
  );
}

export type ItemStatus = "todo" | "doing" | "done" | "skipped";

const STATUS: Record<ItemStatus | "problem", { key: Key; tone: Tone }> = {
  todo: { key: "status.todo", tone: "neutral" },
  doing: { key: "status.doing", tone: "amber" },
  done: { key: "status.done", tone: "ok" },
  skipped: { key: "status.skipped", tone: "neutral" },
  problem: { key: "severity.high", tone: "red" },
};

/** The shape that stands for a status. Each status has its own shape, so colour is never the only sign. */
export function StatusIcon({ status, size = 24, muted = false }: { status: ItemStatus | "problem"; size?: number; muted?: boolean }) {
  // `muted` draws the shape in grey: for a status that is on offer but is not the current one.
  const cls = cx(styles.statusIcon, muted ? styles["s-muted"] : styles[`s-${status}`]);
  if (status === "done") return <IconCheckCircle weight="fill" size={size} className={cls} />;
  if (status === "doing") return <IconCircleHalf weight="fill" size={size} className={cls} />;
  if (status === "skipped") return <IconMinusCircle size={size} className={cls} />;
  if (status === "problem") return <IconWarning weight="fill" size={size} className={cls} />;
  return <IconCircle size={size} className={cls} />;
}

export function StatusChip({ status }: { status: ItemStatus | "problem" }) {
  const { t } = useI18n();
  const s = STATUS[status];
  return (
    <Chip tone={s.tone} icon={<StatusIcon status={status} size={18} />}>
      {t(s.key)}
    </Chip>
  );
}

export type Who = "you" | "employer" | "university" | "government" | "recruiter";

const WHO_ICON = { you: IconUser, employer: IconBuildings, university: IconGraduationCap, government: IconBank, recruiter: IconHandshake };

/** Who does a step. "You" is tinted green so a person can pick out their own steps at a glance. */
export function WhoChip({ who }: { who: Who }) {
  const { t } = useI18n();
  const Icon = WHO_ICON[who];
  return (
    <Chip tone={who === "you" ? "green" : "neutral"} icon={<Icon size={18} />}>
      {t(`who.${who}` as Key)}
    </Chip>
  );
}

type BadgeKind = "draft" | "verified" | "sample" | "machine" | "aiTranslation" | "practice";

/** Trust labels. Draft has a dashed edge (not final); verified is solid and carries its date. */
export function Badge({ kind, date, long = false }: { kind: BadgeKind; date?: string | null; long?: boolean }) {
  const { t, date: fmt } = useI18n();
  if (kind === "verified") {
    return (
      <Chip tone="ok" icon={<IconSealCheck weight="fill" size={18} />} className={styles.badge}>
        {date ? t("badge.verifiedOn", { date: fmt(date) }) : t("badge.verified")}
      </Chip>
    );
  }
  if (kind === "draft") {
    return (
      <Chip tone="amber" icon={<IconPencilSimpleLine size={18} />} className={cx(styles.badge, styles.dashed)}>
        {long ? t("badge.draft.long") : t("badge.draft")}
      </Chip>
    );
  }
  if (kind === "sample") {
    return (
      <Chip tone="neutral" icon={<IconFlask size={18} />} className={cx(styles.badge, styles.dashed)}>
        {long ? t("badge.sample.long") : t("badge.sample")}
      </Chip>
    );
  }
  if (kind === "machine") {
    return (
      <Chip tone="neutral" icon={<IconRobot size={18} />} className={styles.badge}>
        {t("badge.machine")}
      </Chip>
    );
  }
  if (kind === "practice") {
    return (
      <Chip tone="neutral" icon={<IconFlask size={18} />} className={cx(styles.badge, styles.dashed)}>
        {t("badge.practice")}
      </Chip>
    );
  }
  return (
    <Chip tone="neutral" icon={<IconTranslate size={18} />} className={styles.badge}>
      {t("badge.aiTranslation")}
    </Chip>
  );
}
