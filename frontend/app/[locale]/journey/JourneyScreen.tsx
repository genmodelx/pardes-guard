"use client";

import { useEffect, useState } from "react";
import { IconCalendarBlank, IconPencilSimpleLine } from "@/components/icons";
import { JourneyGate, type ReadyJourney } from "@/components/shell/JourneyGate";
import { JourneyPassport } from "@/components/shell/JourneyPassport";
import { PageHead, Screen } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Badge, WhoChip } from "@/components/ui/Chips";
import { Notice } from "@/components/ui/Notice";
import { PassportPage } from "@/components/ui/PassportPage";
import { ProgressMeter } from "@/components/ui/ProgressMeter";
import { Stamp } from "@/components/ui/Stamp";
import { MenuList, MenuRow, StepList, StepRow } from "@/components/ui/StepRow";
import { statusOf, type ProgressReason } from "@/lib/engine/journey";
import { formatStampDate, useI18n } from "@/lib/i18n";
import { itemHref, useLabels } from "@/lib/labels";
import { readLocal, writeLocal } from "@/lib/storage";
import styles from "./Journey.module.css";

// Stamps this phone has already shown landing, as "stage@date". A stamp lands once, the first time
// its page is seen complete, and after that it is simply there.
const SEEN_KEY = "pg.stampsSeen";

function useFreshStamps(stamps: string[]): Set<string> {
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const key = stamps.join("|");
  useEffect(() => {
    const seen = new Set(readLocal<string[]>(SEEN_KEY, []));
    const unseen = stamps.filter((s) => !seen.has(s));
    if (unseen.length) {
      setFresh(new Set(unseen));
      writeLocal(SEEN_KEY, stamps);
    }
    // `key` stands for the list's contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return fresh;
}

function Pages({ plan, journey, progress }: ReadyJourney) {
  const { t, date } = useI18n();
  const labels = useLabels();
  const { answers } = plan;

  const stamps = progress.stages.filter((s) => s.done_at).map((s) => `${s.id}@${s.done_at}`);
  const fresh = useFreshStamps(stamps);

  const reason = (r: ProgressReason): string =>
    r.kind === "done"
      ? t("journey.score.done", { done: r.done, total: r.total })
      : r.kind === "waiting"
        ? t("journey.score.waiting", { n: r.n })
        : r.kind === "red"
          ? t("journey.score.red", { cap: r.cap })
          : t("journey.score.draft", { n: r.n });

  const from = labels.country(answers.origin) ?? t("start.from.other");
  const to = labels.country(answers.destination);
  const someEnglish = plan.items.some((i) => !i.translated);

  return (
    <>
      <PageHead title={t("journey.title")} lead={to ? t("journey.route", { from, to }) : t("journey.routeUnknown")}>
        {plan.route ? <p className={styles.route}>{plan.route.name}</p> : null}
      </PageHead>

      <ProgressMeter
        value={progress.score}
        label={t("journey.score")}
        summary={t("journey.scoreLine", { score: progress.score })}
        whyLabel={t("journey.score.why")}
        reasons={progress.reasons.map(reason)}
      />

      <JourneyPassport more={{ href: "/documents/scan", label: t("deadline.open") }} />

      <MenuList>
        <MenuRow href="/dates" icon={<IconCalendarBlank weight="duotone" size={26} />} title={t("dates.title")} description={t("dates.d")} />
      </MenuList>

      {!plan.route ? (
        <Notice kind="info" action={t("journey.change")} actionHref="/start">
          <p>{t(answers.purpose === "explore" ? "journey.noCountry" : "journey.noCountry.other")}</p>
        </Notice>
      ) : null}
      {someEnglish ? <p className={styles.note}>{t("journey.someEnglish")}</p> : null}

      <div className={styles.pages}>
        {plan.stages.map((stage, index) => {
          const state = progress.stages[index];
          const name = labels.stage(stage.id);
          const stampKey = `${stage.id}@${state.done_at}`;
          // When everything on a page is a draft, the page says so once, not on every row.
          const fromPacks = stage.items.filter((i) => i.content !== "app");
          const allDraft = fromPacks.length > 0 && fromPacks.every((i) => i.content === "draft");
          return (
            <PassportPage
              key={stage.id}
              page={index + 1}
              title={name}
              done={state.done}
              total={state.total}
              note={allDraft ? <Badge kind="draft" long /> : undefined}
              stamp={
                state.done_at ? (
                  <Stamp
                    level="done"
                    size="sm"
                    seed={stage.id}
                    word={t("stamp.done")}
                    line={formatStampDate(state.done_at)}
                    label={t("stamp.done.label", { stage: name, date: date(state.done_at) })}
                    press={fresh.has(stampKey)}
                  />
                ) : undefined
              }
            >
              <StepList>
                {stage.items.map((item) => (
                  <StepRow
                    key={item.id}
                    href={itemHref(item.id)}
                    status={statusOf(journey, item.id)}
                    title={labels.itemTitle(item)}
                    lang={labels.itemLang(item)}
                    meta={
                      <>
                        <WhoChip who={item.who} />
                        {item.content === "draft" && !allDraft ? <Badge kind="draft" /> : null}
                        {item.content === "verified" ? <Badge kind="verified" date={item.last_verified} /> : null}
                      </>
                    }
                  />
                ))}
              </StepList>
            </PassportPage>
          );
        })}
      </div>

      <div className={styles.change}>
        <Button variant="secondary" href="/start" icon={<IconPencilSimpleLine size={22} />} data-testid="change-answers">
          {t("journey.change")}
        </Button>
        <p className={styles.note}>{t("journey.change.help")}</p>
      </div>
    </>
  );
}

/** The whole journey: one passport page per stage, stamped when every step on it is dealt with. */
export function JourneyScreen() {
  const { t } = useI18n();
  return (
    <Screen tab="journey" back={{ href: "/home", label: t("common.home") }}>
      <JourneyGate lines={6}>
        {(ready) => (
          <>
            <Pages {...ready} />
            {ready.saveFailed ? (
              <Notice kind="error" title={t("error.title")} action={t("common.retry")} onAction={ready.reload}>
                <p>{t("error.save")}</p>
              </Notice>
            ) : null}
          </>
        )}
      </JourneyGate>
    </Screen>
  );
}
