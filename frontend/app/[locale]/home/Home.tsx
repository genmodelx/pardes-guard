"use client";

import { IconFileMagnifyingGlass, IconFiles, IconHandCoins, IconIdentificationBadge, IconSiren } from "@/components/icons";
import { JourneyGate, type ReadyJourney } from "@/components/shell/JourneyGate";
import { Screen, Section } from "@/components/shell/Screen";
import { BoardingPass } from "@/components/ui/BoardingPass";
import { Button } from "@/components/ui/Button";
import { Badge, WhoChip } from "@/components/ui/Chips";
import { JourneyStrip } from "@/components/ui/JourneyStrip";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { Notice } from "@/components/ui/Notice";
import { Advanced } from "@/components/ui/Advanced";
import { MenuList, MenuRow } from "@/components/ui/StepRow";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/data";
import { RED_FLAG_CAP } from "@/lib/engine/journey";
import { useI18n } from "@/lib/i18n";
import { itemHref, useLabels } from "@/lib/labels";
import styles from "./Home.module.css";

function NextStep({ plan, progress }: ReadyJourney) {
  const { t } = useI18n();
  const labels = useLabels();
  const { answers } = plan;
  const from = labels.country(answers.origin) ?? t("start.from.other");
  const to = labels.country(answers.destination);
  const next = progress.next;

  return (
    <>
      {next ? (
        <BoardingPass
          from={from}
          to={to}
          route={plan.route?.name}
          kicker={t("home.nextStep")}
          title={labels.itemTitle(next)}
          meta={
            <>
              <WhoChip who={next.who} />
              {next.content === "draft" ? <Badge kind="draft" /> : null}
              <span className={styles.stepOf}>{t("home.stepOf", { n: progress.nextNumber, total: progress.total })}</span>
            </>
          }
          action={
            <Button href={itemHref(next.id)} data-testid="next-step">
              {t("home.doNow")}
            </Button>
          }
        />
      ) : (
        <BoardingPass
          from={from}
          to={to}
          route={plan.route?.name}
          kicker={t("home.progress")}
          title={t("home.allDone.title")}
          action={
            <Button href="/journey" data-testid="next-step">
              {t("home.seeAll")}
            </Button>
          }
        >
          <p>{t("home.allDone.lead")}</p>
        </BoardingPass>
      )}

      <JourneyStrip
        href="/journey"
        summary={t("home.doneCount", { done: progress.done, total: progress.total })}
        action={t("home.seeAll")}
        stages={progress.stages.map((s) => ({ id: s.id, label: `${labels.stage(s.id)}: ${t("journey.stageCount", { done: s.done, total: s.total })}`, status: s.status }))}
      />
    </>
  );
}

/** Home: the one thing to do next, where the journey stands, and the other things the app can do. */
export function Home() {
  const { t, date } = useI18n();
  const auth = useAuth();
  const { store, persistent } = useStore();

  return (
    <Screen tab="journey" band>
      <h1 className="visually-hidden">{t("common.home")}</h1>

      <JourneyGate lines={3}>
        {(ready) => (
          <>
            {ready.openRed.latest ? (
              <Notice kind="error" title={t("home.red.title")} action={t("home.red.action")} actionHref={`/check/result?id=${encodeURIComponent(ready.openRed.latest)}`}>
                <p>{t("journey.score.red", { cap: RED_FLAG_CAP })}</p>
              </Notice>
            ) : null}
            {ready.casesWaiting.latest ? (
              <Notice kind="warning" title={t("cases.waitingOne")} action={t("home.case.action")} actionHref={`/cases/view?id=${encodeURIComponent(ready.casesWaiting.latest.id)}`}>
                <p>{t("home.case.lead", { title: ready.casesWaiting.latest.title })}</p>
              </Notice>
            ) : null}
            {ready.passport && (ready.passport.status === "expired" || ready.passport.status === "short") ? (
              <Notice kind={ready.passport.status === "expired" ? "error" : "warning"} title={t("scan.passport")} action={t("deadline.open")} actionHref="/documents/scan">
                <p>{ready.passport.status === "expired" ? t("scan.passport.expired", { date: date(ready.passport.expiry) }) : t("scan.passport.renewNow")}</p>
              </Notice>
            ) : null}
            <NextStep {...ready} />
            {ready.saveFailed ? (
              <Notice kind="error" title={t("error.title")} action={t("common.retry")} onAction={ready.reload}>
                <p>{t("error.save")}</p>
              </Notice>
            ) : null}
          </>
        )}
      </JourneyGate>

      <Section title={t("home.more")} id="home-more">
        <MenuList>
          <MenuRow href="/check" icon={<IconFileMagnifyingGlass weight="fill" size={26} />} title={t("home.q.check")} description={t("home.q.check.d")} />
          <MenuRow href="/recruiters" icon={<IconIdentificationBadge weight="duotone" size={26} />} title={t("home.q.agent")} description={t("home.q.agent.d")} />
          <MenuRow href="/cost" icon={<IconHandCoins weight="duotone" size={26} />} title={t("home.q.cost")} description={t("home.q.cost.d")} />
          <Advanced>
            <MenuRow href="/documents" icon={<IconFiles weight="duotone" size={26} />} title={t("home.q.docs")} description={t("home.q.docs.d")} />
          </Advanced>
        </MenuList>
      </Section>

      <LocaleLink href="/sos" className={styles.sos}>
        <IconSiren weight="fill" size={28} className={styles.sosIcon} />
        <span className={styles.sosText}>
          <span className={styles.sosTitle}>{t("home.sos.title")}</span>
          <span className={styles.sosAction}>{t("home.sos.action")}</span>
        </span>
      </LocaleLink>

      {store && !persistent ? (
        <Notice kind="warning">
          <p>{t("home.notSaved")}</p>
        </Notice>
      ) : auth.ready && auth.user.guest ? (
        <p className={styles.note}>
          <span>{t("home.guest")}</span>{" "}
          {auth.canSignIn ? <LocaleLink href="/signin">{t("home.guest.action")}</LocaleLink> : null}
        </p>
      ) : null}

      <p className={styles.note}>{t("home.draft")}</p>
    </Screen>
  );
}
