"use client";

import { useEffect, useState } from "react";
import { IconFileMagnifyingGlass, IconMegaphone, IconStar } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Chips";
import { Fact, FactList } from "@/components/ui/Facts";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { RecruiterStatusChip } from "@/components/ui/RecruiterStatus";
import { ReportSheet } from "@/components/ui/ReportSheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { SourceChip } from "@/components/ui/SourceChip";
import { useAuth } from "@/lib/auth";
import { useJourney, useStore } from "@/lib/data";
import { recruiterKey } from "@/lib/engine/network";
import { rich, useI18n } from "@/lib/i18n";
import { useQueryParam } from "@/lib/query";
import type { RiskEntry } from "@/lib/engine/check";
import type { RatingSummary } from "@/lib/store";
import type { RecruiterRecord } from "@/lib/types";
import { ListNote, useDirectory, useListOffice } from "../RecruitersScreen";
import styles from "../Recruiters.module.css";

const STATUS_NOTICE = { active: "success", suspended: "warning", cancelled: "error" } as const;

/** One agent on the licensed list: the licence's status, any warning from our team, and ratings. */
export function RecruiterScreen() {
  const { t } = useI18n();
  const licence = useQueryParam("licence");
  const { directory, failed, retry } = useDirectory();
  const record = directory?.byLicenseNo(licence) ?? null;

  return (
    <Screen tab="check" back={{ href: "/recruiters", label: t("rec.back") }}>
      {failed ? <ErrorNotice kind="load" onRetry={retry} /> : null}
      {!directory && !failed ? <Skeleton lines={6} label={t("common.loading")} /> : null}
      {directory && !record ? (
        <>
          <PageHead title={t("rec.notFound")} lead={t("rec.notFound.help")} />
          {licence ? (
            <p>
              {rich(t("result.recruiter.licence"), {
                licence: (
                  <bdi dir="ltr" className={styles.licence}>
                    {licence}
                  </bdi>
                ),
              })}
            </p>
          ) : null}
          <ListNote directory={directory} />
          <Button variant="secondary" href="/recruiters">
            {t("rec.back")}
          </Button>
        </>
      ) : null}
      {directory && record ? <Agent record={record} sample={directory.isSample} /> : null}
    </Screen>
  );
}

function Agent({ record, sample }: { record: RecruiterRecord; sample: boolean }) {
  const { t, date } = useI18n();
  const { store } = useStore();
  const journey = useJourney();
  const { office, site } = useListOffice();
  const [risk, setRisk] = useState<RiskEntry | null>(null);
  const [report, setReport] = useState(false);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    void (async () => {
      const key = await recruiterKey(record.license_no, record.name);
      const found = key ? await store.getRisk(key).catch(() => null) : null;
      if (!cancelled) setRisk(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [store, record]);

  // Looking an agent up on the official list is a step of the journey. A lookup in the fictional
  // sample list is not: the person still has to check their real agent.
  useEffect(() => {
    if (sample || !journey.plan) return;
    const step = journey.plan.items.find((i) => i.app === "checkAgent");
    if (step && journey.journey?.items[step.id]?.status !== "done") void journey.setStatus(step.id, "done");
  }, [sample, journey]);

  return (
    <>
      {sample ? (
        <div>
          <Badge kind="sample" long />
        </div>
      ) : null}
      <PageHead title={record.name} lang="en">
        <div className={styles.agentHead}>
          <p>
            {rich(t("result.recruiter.licence"), {
              licence: (
                <bdi dir="ltr" className={styles.licence}>
                  {record.license_no}
                </bdi>
              ),
            })}
          </p>
          <RecruiterStatusChip status={record.status} />
        </div>
      </PageHead>

      <Notice kind={STATUS_NOTICE[record.status]}>
        <p>{t(`rec.status.${record.status}.long`)}</p>
        {record.status === "active" ? <p>{t("rec.active.note")}</p> : null}
      </Notice>

      {risk ? (
        <Panel title={t("rec.risk.title")} tone="danger">
          <p>{t("rec.risk.lead")}</p>
          <ul lang="en">
            {risk.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <FactList>
        {record.city ? (
          <Fact label={t("rec.city")}>
            <span lang="en">{record.city}</span>
          </Fact>
        ) : null}
        {record.list_date ? <Fact label={t("rec.listDate")}>{date(record.list_date)}</Fact> : null}
      </FactList>

      {office ? (
        <Section title={t("rec.officialList")} id="rec-official">
          <p>{t("rec.official", { office })}</p>
          {site ? <SourceChip source={site} /> : null}
        </Section>
      ) : null}

      <Ratings licence={record.license_no} />

      <div className={styles.actions}>
        <Button href="/check" icon={<IconFileMagnifyingGlass weight="fill" size={24} />} data-testid="check-paper">
          {t("rec.checkPaper")}
        </Button>
        <Button variant="secondary" full icon={<IconMegaphone size={22} />} onClick={() => setReport(true)} data-testid="report">
          {t("verdict.report")}
        </Button>
      </div>

      <ReportSheet open={report} onClose={() => setReport(false)} recruiter={{ name: record.name, license: record.license_no }} />
    </>
  );
}

/** Stars from signed-in workers. Guests see why there are none: ratings need an account. */
function Ratings({ licence }: { licence: string }) {
  const { t } = useI18n();
  const { store } = useStore();
  const auth = useAuth();
  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const shared = store?.kind === "firestore";

  useEffect(() => {
    if (!store || !shared) return;
    let cancelled = false;
    store
      .ratingsFor(licence)
      .then((s) => !cancelled && setSummary(s))
      .catch(() => !cancelled && setSummary({ average: null, count: 0, mine: null }));
    return () => {
      cancelled = true;
    };
  }, [store, shared, licence]);

  const rate = async (stars: number) => {
    if (!store) return;
    setState("saving");
    try {
      await store.rate(licence, stars);
      setSummary(await store.ratingsFor(licence));
      setState("saved");
    } catch {
      setState("failed");
    }
  };

  return (
    <Section title={t("rec.ratings")} id="rec-ratings">
      {!shared ? (
        <>
          <p>{auth.canSignIn ? t("rec.rate.signin") : t("rec.rate.off")}</p>
          {auth.canSignIn ? (
            <Button variant="secondary" full={false} href="/signin">
              {t("common.signin")}
            </Button>
          ) : null}
        </>
      ) : !summary ? (
        <Skeleton lines={2} label={t("common.loading")} />
      ) : (
        <>
          <p className={styles.average}>
            <IconStar weight="fill" size={22} />
            <span>{summary.average !== null ? t("rec.rating", { avg: summary.average, n: summary.count }) : t("rec.noRating")}</span>
          </p>
          <fieldset className={styles.stars} disabled={state === "saving"}>
            <legend className="visually-hidden">{t("rec.rate")}</legend>
            {[1, 2, 3, 4, 5].map((n) => (
              <label key={n} className={styles.star} title={t("rec.stars", { n })}>
                <input type="radio" name="stars" value={n} checked={summary.mine === n} onChange={() => void rate(n)} aria-label={t("rec.stars", { n })} />
                <IconStar weight={summary.mine !== null && n <= summary.mine ? "fill" : "regular"} size={32} />
              </label>
            ))}
          </fieldset>
          <p className="small soft">{summary.mine ? t("rec.rate.mine", { n: summary.mine }) : t("rec.rate.pick")}</p>
          <p className="small soft">{t("rec.rate.help")}</p>
          {state === "saved" ? (
            <p className="small" role="status">
              {t("rec.rated")}
            </p>
          ) : null}
          {state === "failed" ? <ErrorNotice kind="save" /> : null}
        </>
      )}
    </Section>
  );
}
