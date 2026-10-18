"use client";

import { useId } from "react";
import { IconCalendarBlank, IconPassport } from "@/components/icons";
import { cx } from "@/lib/cx";
import { calendarLink, passportDeadline, type PassportCheck } from "@/lib/engine/readiness";
import { useI18n } from "@/lib/i18n";
import type { SourceRef } from "@/lib/types";
import { Button } from "./Button";
import { LocaleLink } from "./LocaleLink";
import { SourceList } from "./SourceChip";
import styles from "./PassportStatus.module.css";

/** "4 months", "1 month", "less than a month". */
export function useMonths(): (n: number) => string {
  const { t } = useI18n();
  return (n) => (n <= 0 ? t("unit.months.zero") : n === 1 ? t("unit.months.one") : t("unit.months.other", { n }));
}

const TONE: Record<PassportCheck["status"], "red" | "amber" | "green" | "neutral"> = {
  expired: "red",
  short: "amber",
  "no-date": "amber",
  ok: "green",
  "no-rule": "neutral",
  missing: "neutral",
};

/**
 * The passport's dates against the visa's rule: valid until when, how long is left, and what to do.
 * The rule and the dates come from code (lib/engine/readiness); nothing here is worked out by AI.
 */
export function PassportStatus({
  check,
  route,
  today,
  sources = [],
  guideHref = null,
  more,
  level = 2,
  calendar: offerCalendar = true,
  compact = false,
}: {
  check: PassportCheck;
  /** The visa's name, or null when no visa is chosen yet. */
  route: string | null;
  today: string;
  /** Where the visa's own rules are published. Shown when the rule is not added yet. */
  sources?: SourceRef[];
  /** The guide to getting a new passport, for an expired or short passport. */
  guideHref?: string | null;
  /** A link at the foot of the card, such as "See the scan" on the journey. */
  more?: { href: string; label: string };
  /** 3 when the card sits inside a section with its own heading. */
  level?: 2 | 3;
  /** False for sample papers: a fictional passport's date has no place in a real calendar. */
  calendar?: boolean;
  /** Leaves out the list of official sites (the journey links to the scan, which has them). */
  compact?: boolean;
}) {
  const { t, date } = useI18n();
  const months = useMonths();
  const tone = TONE[check.status];
  const Heading = level === 3 ? "h3" : "h2";
  const headingId = useId();
  const deadline = passportDeadline(check);
  // A rule (and so a renew-by date) only exists for a chosen visa, so `route` is set wherever it is used.
  const routeName = route ?? "";
  const calendar =
    offerCalendar && deadline && deadline.date > today && check.status !== "short"
      ? calendarLink(
          deadline.kind === "renew-by" ? t("scan.calendar.renew", { route: routeName }) : t("scan.calendar.expiry"),
          deadline.date,
          t("scan.calendar.details"),
        )
      : null;

  return (
    <section className={cx(styles.card, styles[tone])} aria-labelledby={headingId} data-testid="passport-status" data-status={check.status}>
      <Heading className={styles.kicker} id={headingId}>
        <IconPassport weight="duotone" size={24} className={styles.icon} />
        <span>{t("scan.passport")}</span>
      </Heading>

      {check.expiry ? (
        <div className={styles.dates}>
          <p className={styles.until}>
            <span className={styles.label}>{t("scan.expiry")}</span>
            <span className={styles.date}>{date(check.expiry)}</span>
          </p>
          <span className={styles.left}>{check.status === "expired" ? t("scan.passport.expiredChip") : t("scan.passport.left", { left: months(check.monthsLeft ?? 0) })}</span>
        </div>
      ) : null}

      <div className={styles.text}>
        {check.status === "missing" ? <p>{t("scan.passport.missing")}</p> : null}
        {check.status === "no-date" ? <p>{t("scan.passport.noDate")}</p> : null}
        {check.status === "expired" ? <p className={styles.strong}>{t("scan.passport.expired", { date: date(check.expiry) })}</p> : null}
        {check.rule && (check.status === "short" || check.status === "ok") ? <p>{t("scan.passport.need", { route: routeName, need: months(check.rule.months) })}</p> : null}
        {check.status === "short" ? <p className={styles.strong}>{t("scan.passport.renewNow")}</p> : null}
        {check.status === "ok" && check.renewBy ? <p>{t("scan.passport.renewBy", { date: date(check.renewBy) })}</p> : null}
        {check.status === "no-rule" ? <p>{route ? t("scan.passport.noRule", { route }) : t("scan.passport.noRoute")}</p> : null}
      </div>

      {!compact && check.status === "no-rule" && route && sources.length ? <SourceList sources={sources} /> : null}
      {!compact && check.rule && (check.status === "short" || check.status === "ok") && check.rule.sources.length ? <SourceList sources={check.rule.sources} /> : null}

      {(check.status === "expired" || check.status === "short") && guideHref ? (
        <Button variant="secondary" full href={guideHref} data-testid="passport-guide">
          {t("scan.passport.guide")}
        </Button>
      ) : null}
      {calendar ? (
        <Button variant="secondary" full href={calendar} external icon={<IconCalendarBlank size={22} />} data-testid="calendar">
          {t("scan.calendar")}
        </Button>
      ) : null}
      {more ? (
        <LocaleLink href={more.href} className={styles.more}>
          {more.label}
        </LocaleLink>
      ) : null}
    </section>
  );
}
