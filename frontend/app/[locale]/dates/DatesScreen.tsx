"use client";

import { useCallback, useEffect, useState } from "react";
import { IconCalendarPlus, IconPlus, IconTrash } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextInput } from "@/components/ui/Field";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { ErrorNotice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { useJourney, useStore } from "@/lib/data";
import { cleanOwnDate, collectDeadlines, daysUntil, type Deadline, type OwnDate } from "@/lib/engine/deadlines";
import { calendarLink, localToday, passportDeadline } from "@/lib/engine/readiness";
import { randomId } from "@/lib/engine/text";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import type { Case } from "@/lib/types";
import styles from "./Dates.module.css";

/** Important dates: the passport, each open case's next step, and the person's own dates. */
export function DatesScreen() {
  const { t, date } = useI18n();
  const { store } = useStore();
  const journey = useJourney();
  const [cases, setCases] = useState<Case[] | null>(null);
  const [mine, setMine] = useState<OwnDate[]>([]);
  const [failed, setFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [day, setDay] = useState("");
  const [need, setNeed] = useState(false);
  const [saving, setSaving] = useState(false);
  const today = localToday();

  const load = useCallback(async () => {
    if (!store) return;
    setFailed(false);
    try {
      const [list, user] = await Promise.all([store.listCases(), store.getUser()]);
      setCases(list);
      setMine(user.dates);
    } catch {
      setFailed(true);
    }
  }, [store]);
  useEffect(() => void load(), [load]);

  const save = async (next: OwnDate[]) => {
    if (!store) return;
    setSaving(true);
    try {
      await store.saveDates(next);
      setMine(next);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const add = () => {
    const own = cleanOwnDate({ title, date: day }, randomId("date", 6));
    if (!own) return setNeed(true);
    setNeed(false);
    setTitle("");
    setDay("");
    void save([...mine, own]);
  };

  const passport = journey.passport ? passportDeadline(journey.passport) : null;
  const list = cases ? collectDeadlines({ passport, cases, mine }) : null;

  /** What the date is, in the reader's words. */
  const what = (d: Deadline): { text: string; lang?: string } =>
    d.source === "passport" ? { text: t(`dates.passport.${d.passportKind}` as Key) } : d.source === "case" ? { text: t(`step.${d.stepAction}` as Key) } : { text: d.title ?? "" };

  const when = (d: Deadline) => {
    const n = daysUntil(d.date, today);
    return n === 0 ? t("dates.today") : n === 1 ? t("dates.tomorrow") : n === -1 ? t("dates.yesterday") : n > 0 ? t("dates.left", { n }) : t("dates.past", { n: -n });
  };

  return (
    <Screen tab="journey" back={{ href: "/journey", label: t("journey.title") }}>
      <PageHead title={t("dates.title")} lead={t("dates.lead")} />

      {failed ? <ErrorNotice kind="load" onRetry={() => void load()} /> : null}
      {!list && !failed ? <Skeleton lines={4} label={t("common.loading")} /> : null}

      {list ? (
        list.length ? (
          <ol className={styles.list} data-testid="dates">
            {list.map((d) => {
              const n = daysUntil(d.date, today);
              const label = what(d);
              return (
                <li key={d.id} className={styles.item} data-source={d.source} data-testid="date">
                  <div className={styles.when}>
                    <span className={styles.day}>{date(d.date)}</span>
                    <Chip tone={n < 0 ? "red" : n <= 14 ? "amber" : "neutral"}>{when(d)}</Chip>
                  </div>
                  <p className={styles.what} lang={label.lang} dir="auto">
                    {label.text}
                  </p>
                  <p className={styles.from}>
                    {d.source === "passport" ? (
                      <LocaleLink href="/documents/scan">{t("dates.from.passport")}</LocaleLink>
                    ) : d.source === "case" ? (
                      <LocaleLink href={`/cases/view?id=${encodeURIComponent(d.caseId ?? "")}`}>{t("dates.from.case", { case: d.caseTitle ?? "" })}</LocaleLink>
                    ) : (
                      t("dates.from.mine")
                    )}
                  </p>
                  <div className={styles.actions}>
                    <Button variant="secondary" compact full={false} href={calendarLink(label.text, d.date)} external icon={<IconCalendarPlus size={20} />}>
                      {t("dates.calendar")}
                    </Button>
                    {d.source === "mine" ? (
                      <Button variant="quiet" compact full={false} icon={<IconTrash size={20} />} disabled={saving} onClick={() => void save(mine.filter((m) => `mine:${m.id}` !== d.id))}>
                        {t("dates.remove")}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className={styles.empty}>{t("dates.empty")}</p>
        )
      ) : null}

      <Section title={t("dates.add")} id="dates-add">
        <div className={styles.form}>
          <TextInput label={t("dates.add.what")} hint={t("dates.add.what.help")} value={title} onChange={setTitle} maxLength={120} error={need && !title.trim() ? t("dates.add.need") : null} />
          <TextInput label={t("dates.add.when")} type="date" value={day} onChange={setDay} ltr mic={false} error={need && title.trim() && !day ? t("dates.add.need") : null} />
          <Button variant="secondary" full={false} icon={<IconPlus size={22} />} busy={saving} disabled={!store} onClick={add} data-testid="date-add">
            {t("dates.add.save")}
          </Button>
        </div>
      </Section>
    </Screen>
  );
}
