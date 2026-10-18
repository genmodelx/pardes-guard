"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconCalculator, IconIdentificationBadge } from "@/components/icons";
import { PageHead, Screen, Section, StickyActions } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Badge, WhoChip } from "@/components/ui/Chips";
import { Select } from "@/components/ui/Field";
import { MoneyInput, moneyFrom, type MoneyValue } from "@/components/ui/MoneyInput";
import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { SourceChip, SourceList } from "@/components/ui/SourceChip";
import { useJourney } from "@/lib/data";
import { analyzeAsk, recruitmentFeeCap, routeCosts, type AskAnalysis } from "@/lib/engine/cost";
import { routeChoices, type Who } from "@/lib/engine/journey";
import { localized } from "@/lib/engine/packs";
import { formatMoney, useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { useLabels } from "@/lib/labels";
import { PACK_INDEX, indexEntry, loadPack } from "@/lib/packs";
import type { Actor, CountryPack } from "@/lib/types";
import styles from "./Cost.module.css";

const WHO: Record<Actor, Who> = { worker: "you", employer: "employer", recruiter: "recruiter", government: "government", university: "university" };

/** What a visa route should really cost, and what the agent's ask leaves over. */
export function CostScreen() {
  const { t, locale } = useI18n();
  const labels = useLabels();
  const journey = useJourney();
  const answers = journey.plan?.answers ?? null;

  const [choice, setChoice] = useState<{ origin: string; destination: string; route: string }>({ origin: "", destination: "", route: "" });
  const fromJourney = useRef(false);
  useEffect(() => {
    if (fromJourney.current || journey.status === "loading") return;
    fromJourney.current = true;
    if (answers) setChoice({ origin: answers.origin ?? "", destination: answers.destination ?? "", route: answers.route_id ?? "" });
  }, [journey.status, answers]);

  const [packs, setPacks] = useState<{ origin: CountryPack | null; destination: CountryPack | null; loading: boolean }>({ origin: null, destination: null, loading: true });
  useEffect(() => {
    let cancelled = false;
    setPacks((p) => ({ ...p, loading: true }));
    void Promise.all([loadPack(choice.origin || null), loadPack(choice.destination || null)]).then(([origin, destination]) => {
      if (!cancelled) setPacks({ origin, destination, loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [choice.origin, choice.destination]);

  const route = packs.destination?.visa_routes.find((r) => r.id === choice.route) ?? null;
  const lines = useMemo(() => (route ? routeCosts(route, choice.origin || null, locale) : []), [route, choice.origin, locale]);
  const cap = recruitmentFeeCap(packs.origin);
  const [ask, setAsk] = useState<MoneyValue>({ amount: "", currency: "PKR" });
  useEffect(() => {
    const currency = indexEntry(choice.origin)?.currency;
    if (currency) setAsk((a) => (a.amount ? a : { ...a, currency }));
  }, [choice.origin]);
  const [analysis, setAnalysis] = useState<AskAnalysis | null>(null);
  const [needAmount, setNeedAmount] = useState(false);
  useEffect(() => setAnalysis(null), [route, choice.origin]);

  const checked = lines.filter((l) => l.amount);
  const destinationEntries = PACK_INDEX.filter((p) => p.kind !== "origin");
  const destEntry = indexEntry(choice.destination);
  const routeOptions = destEntry ? routeChoices(destEntry, "explore").map((r) => ({ value: r.id, label: localized(r, locale).name })) : [];
  const country = labels.country(choice.origin) ?? t("start.from.other");
  const office = packs.origin?.regulator ? (localized(packs.origin, locale).regulator ?? packs.origin.regulator) : t("verify.labour_ministry");
  // The office's own site, when the home country's pack lists it among its official sources.
  const officeSite = packs.origin?.regulator ? (packs.origin.official_sources.find((s) => packs.origin?.regulator?.startsWith(s.title)) ?? null) : null;

  const compare = async () => {
    const asked = moneyFrom(ask);
    if (!asked) return setNeedAmount(true);
    setNeedAmount(false);
    setAnalysis(analyzeAsk(lines, asked, packs.origin));
    // Looking at the real cost is a step of the journey.
    const step = journey.plan?.items.find((i) => i.app === "cost");
    if (step && journey.journey?.items[step.id]?.status !== "done") await journey.setStatus(step.id, "done");
  };

  return (
    <Screen tab="check" back={{ href: "/home", label: t("common.home") }}>
      <PageHead title={t("app.cost")} lead={t("cost.lead")} />

      <div className={styles.choose}>
        <Select
          label={t("cost.pickCountry")}
          value={choice.destination}
          onChange={(destination) => setChoice((c) => ({ ...c, destination, route: indexEntry(destination)?.routes[0]?.id ?? "" }))}
          options={destinationEntries.map((p) => ({ value: p.code, label: labels.country(p.code) ?? p.name }))}
          placeholder=""
        />
        {routeOptions.length > 1 ? <Select label={t("cost.pickRoute")} value={choice.route} onChange={(r) => setChoice((c) => ({ ...c, route: r }))} options={routeOptions} /> : null}
      </div>

      {!choice.destination || !choice.route ? (
        <Notice kind="info">
          <p>{t("cost.noRoute")}</p>
        </Notice>
      ) : packs.loading ? (
        <Skeleton lines={5} label={t("common.loading")} />
      ) : route ? (
        <>
          <Section title={t("cost.official")} id="cost-official">
            {lines.length && !checked.length ? (
              <Notice kind="warning" title={t("cost.none")}>
                <p>{t("cost.notChecked.help")}</p>
              </Notice>
            ) : route.status === "draft" ? (
              <div>
                <Badge kind="draft" long />
              </div>
            ) : null}
            {lines.length ? (
              <ul className={styles.lines}>
                {lines.map((line) => (
                  <li key={line.id} className={styles.line}>
                    <div className={styles.lineHead}>
                      <span className={styles.item} lang={line.translated ? undefined : "en"}>
                        {line.item}
                      </span>
                      {line.amount ? (
                        <bdi className={styles.amount} dir="ltr">
                          {formatMoney(line.amount)}
                        </bdi>
                      ) : (
                        <span className={styles.unknown}>{t("cost.notChecked")}</span>
                      )}
                    </div>
                    {line.paid_by ? (
                      <p className={`small ${styles.who}`}>
                        <span>{t("cost.paidBy")}</span>
                        <WhoChip who={WHO[line.paid_by]} />
                      </p>
                    ) : null}
                    {line.source ? <SourceChip source={line.source} checked={line.last_verified} /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p>{t("cost.empty")}</p>
            )}
            {checked.length ? <p className={styles.total}>{t("cost.counted", { n: checked.length, total: lines.length })}</p> : null}
            {route.sources.length ? (
              <>
                <h3>{t("cost.sources")}</h3>
                <SourceList sources={route.sources} checked={route.last_verified} />
              </>
            ) : null}
          </Section>

          <Section title={t("cost.capTitle")} id="cost-cap">
            {cap ? (
              <>
                <p>{t("cost.cap", { country, amount: formatMoney(cap.amount) })}</p>
                <SourceChip source={cap.source} />
              </>
            ) : (
              <>
                <p>{t("cost.cap.none", { country, office })}</p>
                {officeSite ? <SourceChip source={officeSite} checked={packs.origin?.last_verified} /> : null}
              </>
            )}
          </Section>

          <div className={styles.ask} id="cost-ask">
            <MoneyInput label={t("cost.ask")} hint={t("cost.ask.help")} value={ask} onChange={setAsk} error={needAmount ? t("cost.needAmount") : null} />
          </div>

          {analysis ? (
            <Section title={t("cost.result")} id="cost-result">
              <div className={styles.result} role="status">
                <p className={styles.asked}>{t("cost.asked", { amount: formatMoney(analysis.asked) })}</p>
                {analysis.officialTotal ? (
                  <>
                    <p>{t("cost.total", { amount: formatMoney(analysis.officialTotal) })}</p>
                    <p className={styles.asked}>{t("cost.left", { amount: formatMoney(analysis.agentPart) })}</p>
                    <p className="small soft">{t("cost.left.help")}</p>
                  </>
                ) : (
                  <p>{t("cost.cannot")}</p>
                )}
                {analysis.otherCurrency ? <p className="small soft">{t("cost.otherCurrency", { n: analysis.otherCurrency })}</p> : null}
              </div>
              <Notice kind={analysis.aboveCap === "yes" ? "error" : analysis.aboveCap === "maybe" ? "warning" : analysis.aboveCap === "no" ? "success" : "info"}>
                <p>{t(`cost.above.${analysis.aboveCap}` as Key)}</p>
                <p>{t("next.payByBank")}</p>
              </Notice>
              <Button variant="secondary" full href="/recruiters" icon={<IconIdentificationBadge size={22} />}>
                {t("cost.agent")}
              </Button>
            </Section>
          ) : null}

          <p className="small soft">{t("legal.info")}</p>

          <StickyActions>
            <Button onClick={() => void compare()} icon={<IconCalculator size={24} />} data-testid="compare">
              {t("cost.compare")}
            </Button>
          </StickyActions>
        </>
      ) : (
        <Notice kind="info">
          <p>{t("cost.empty")}</p>
        </Notice>
      )}
    </Screen>
  );
}
