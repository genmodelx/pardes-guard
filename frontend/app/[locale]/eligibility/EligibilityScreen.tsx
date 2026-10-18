"use client";

import { useEffect, useMemo, useState } from "react";
import { IconCheckCircle, IconListChecks, IconPlus, IconQuestion, IconWarning, IconX, IconXCircle } from "@/components/icons";
import { PageHead, Screen, Section, StickyActions } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Badge, Chip } from "@/components/ui/Chips";
import { ChoiceGroup, ChoiceTile } from "@/components/ui/ChoiceTile";
import { Select, TextInput } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { SourceList } from "@/components/ui/SourceChip";
import { useJourney } from "@/lib/data";
import { evaluateRoute } from "@/lib/engine/eligibility";
import { localized } from "@/lib/engine/packs";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { useLabels } from "@/lib/labels";
import { PACK_INDEX, loadPack } from "@/lib/packs";
import { EDUCATION_ORDER, type CountryPack, type EligibilityItem, type EligibilityResult, type EligibilityStatus, type Profile, type VisaRoute } from "@/lib/types";
import styles from "./Eligibility.module.css";

type Purpose = "work" | "study" | "any";
type Answer = "" | "yes" | "no";

/** The tests the packs list, with how a result is written: a level (JLPT N4) or an overall score. */
const TESTS: { id: string; levels?: string[] }[] = [
  { id: "IELTS_GT" },
  { id: "PTE_CORE" },
  { id: "CELPIP_G" },
  { id: "JLPT", levels: ["N5", "N4", "N3", "N2", "N1"] },
  { id: "JFT_BASIC", levels: ["below_A2", "A2"] },
];

interface TestRow {
  key: number;
  test: string;
  overall: string;
  level: string;
}

const STATUS_LOOK: Record<EligibilityStatus, { tone: "ok" | "red" | "amber" | "neutral"; Icon: typeof IconCheckCircle }> = {
  met: { tone: "ok", Icon: IconCheckCircle },
  not_met: { tone: "red", Icon: IconXCircle },
  unknown: { tone: "amber", Icon: IconQuestion },
  manual_check: { tone: "neutral", Icon: IconWarning },
};

const numberOrNull = (v: string, max: number) => {
  const n = Number(v);
  return v.trim() && Number.isFinite(n) && n >= 0 && n <= max ? n : null;
};
const answer = (v: Answer) => (v === "yes" ? true : v === "no" ? false : null);

/** Where could I go? A profile against every route's listed requirements. Code compares; nothing is decided. */
export function EligibilityScreen() {
  const { t, locale } = useI18n();
  const labels = useLabels();
  const journey = useJourney();

  const [purpose, setPurpose] = useState<Purpose>("any");
  const [age, setAge] = useState("");
  const [education, setEducation] = useState("");
  const [experience, setExperience] = useState("");
  const [passport, setPassport] = useState("");
  const [fromScan, setFromScan] = useState(false);
  const [skills, setSkills] = useState<Answer>("");
  const [police, setPolice] = useState<Answer>("");
  const [tests, setTests] = useState<TestRow[]>([]);
  const [packs, setPacks] = useState<CountryPack[] | null>(null);
  const [results, setResults] = useState<{ pack: CountryPack; route: VisaRoute; result: EligibilityResult }[] | null>(null);

  // Start from the journey: its purpose, and the passport months from the document scan.
  useEffect(() => {
    const p = journey.plan?.answers.purpose;
    if (p === "work" || p === "study") setPurpose(p);
  }, [journey.plan?.answers.purpose]);
  useEffect(() => {
    if (journey.passport?.monthsLeft != null && journey.passport.monthsLeft >= 0) {
      setPassport((v) => v || String(journey.passport?.monthsLeft));
      setFromScan(true);
    }
  }, [journey.passport]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(PACK_INDEX.filter((p) => p.kind !== "origin").map((p) => loadPack(p.code))).then((list) => {
      if (!cancelled) setPacks(list.filter((p): p is CountryPack => Boolean(p)));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const profile = useMemo<Profile>(
    () => ({
      age: numberOrNull(age, 120),
      education_level: education || null,
      experience_years: numberOrNull(experience, 60),
      passport_valid_months: numberOrNull(passport, 240),
      has_skills_certificate: answer(skills),
      has_police_clearance: answer(police),
      tests: tests
        .filter((r) => r.test)
        .map((r) => ({ test: r.test, overall: numberOrNull(r.overall, 1000), level: r.level || null, components: {} })),
    }),
    [age, education, experience, passport, skills, police, tests],
  );

  const compare = async () => {
    if (!packs) return;
    const rows = packs
      .flatMap((pack) => pack.visa_routes.filter((r) => purpose === "any" || r.purpose === purpose).map((route) => ({ pack, route, result: evaluateRoute(pack.code, route, profile) })))
      .sort((a, b) => a.result.not_met - b.result.not_met || b.result.met - a.result.met);
    setResults(rows);
    // Exploring the routes is the first step of an "explore" journey.
    const step = journey.plan?.items.find((i) => i.app === "eligibility");
    if (step && journey.journey?.items[step.id]?.status !== "done") await journey.setStatus(step.id, "done");
    window.requestAnimationFrame(() => document.getElementById("elig-results")?.scrollIntoView({ block: "start" }));
  };

  const addTest = () => setTests((rows) => [...rows, { key: Date.now(), test: "", overall: "", level: "" }]);
  const editTest = (key: number, patch: Partial<TestRow>) => setTests((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const yesNo = [
    { value: "yes", label: t("common.yes") },
    { value: "no", label: t("common.no") },
  ];

  return (
    <Screen tab="journey" back={{ href: "/journey", label: t("journey.title") }}>
      <PageHead title={t("elig.title")} lead={t("elig.lead")} />

      <Section title={t("elig.purpose")} id="elig-purpose">
        <ChoiceGroup legendId="elig-purpose" dense>
          {(["work", "study", "any"] as const).map((p) => (
            <ChoiceTile key={p} value={p} checked={purpose === p} onChange={() => setPurpose(p)} picture={<IconListChecks weight="duotone" size={28} />} title={p === "any" ? t("elig.any") : t(`purpose.${p}` as Key)} />
          ))}
        </ChoiceGroup>
      </Section>

      <Section title={t("elig.about")} id="elig-about">
        <TextInput label={t("elig.age")} value={age} onChange={(v) => setAge(v.replace(/[^\d]/g, "").slice(0, 3))} inputMode="numeric" ltr mic={false} optional />
        <Select label={t("elig.education")} value={education} onChange={setEducation} options={EDUCATION_ORDER.map((e) => ({ value: e, label: t(`edu.${e}` as Key) }))} placeholder={t("common.unknown")} optional />
        <TextInput label={t("elig.experience")} value={experience} onChange={(v) => setExperience(v.replace(/[^\d.]/g, "").slice(0, 4))} inputMode="decimal" ltr mic={false} optional />
        <TextInput label={t("elig.passport")} hint={fromScan ? t("elig.fromScan") : undefined} value={passport} onChange={(v) => setPassport(v.replace(/[^\d]/g, "").slice(0, 3))} inputMode="numeric" ltr mic={false} optional />
        <Select label={t("elig.skills")} value={skills} onChange={(v) => setSkills(v as Answer)} options={yesNo} placeholder={t("common.unknown")} optional />
        <Select label={t("elig.police")} value={police} onChange={(v) => setPolice(v as Answer)} options={yesNo} placeholder={t("common.unknown")} optional />
      </Section>

      <Section title={t("elig.tests")} id="elig-tests">
        <p className="small soft">{t("elig.tests.help")}</p>
        {tests.map((row) => {
          const spec = TESTS.find((x) => x.id === row.test);
          return (
            <div key={row.key} className={styles.test} data-testid="test-row">
              <Select label={t("elig.test")} value={row.test} onChange={(test) => editTest(row.key, { test, level: "", overall: "" })} options={TESTS.map((x) => ({ value: x.id, label: t(`elig.testname.${x.id}` as Key) }))} placeholder="" />
              {spec?.levels ? (
                <Select label={t("elig.level")} value={row.level} onChange={(level) => editTest(row.key, { level })} options={spec.levels.map((l) => ({ value: l, label: l.replace(/_/g, " ") }))} placeholder="" />
              ) : spec ? (
                <TextInput label={t("elig.overall")} value={row.overall} onChange={(overall) => editTest(row.key, { overall: overall.replace(/[^\d.]/g, "").slice(0, 5) })} inputMode="decimal" ltr mic={false} />
              ) : null}
              <Button variant="quiet" full={false} icon={<IconX weight="bold" size={18} />} onClick={() => setTests((rows) => rows.filter((r) => r.key !== row.key))}>
                {t("elig.removeTest")}
              </Button>
            </div>
          );
        })}
        <Button variant="secondary" full={false} icon={<IconPlus weight="bold" size={20} />} onClick={addTest} data-testid="add-test">
          {t("elig.addTest")}
        </Button>
      </Section>

      {results ? (
        <Section title={t("elig.results")} id="elig-results">
          {results.length ? (
            <ul className={styles.routes}>
              {results.map(({ pack, route, result }) => (
                <RouteResult key={route.id} country={labels.country(pack.code) ?? pack.name} route={localized(route, locale)} result={result} raw={route} />
              ))}
            </ul>
          ) : (
            <p>{t("elig.empty")}</p>
          )}
          <p className="small soft">{t("elig.disclaimer")}</p>
        </Section>
      ) : null}

      <StickyActions>
        <Button onClick={() => void compare()} disabled={!packs} icon={<IconListChecks size={24} />} data-testid="compare-routes">
          {t("elig.submit")}
        </Button>
      </StickyActions>
      {!packs ? <Skeleton lines={2} label={t("common.loading")} /> : null}
    </Screen>
  );
}

/** One route: its counts, and each requirement with why it looks met or not. */
function RouteResult({ country, route, raw, result }: { country: string; route: VisaRoute; raw: VisaRoute; result: EligibilityResult }) {
  const { t, locale } = useI18n();
  const words = useWhy();
  return (
    <li className={styles.route} data-testid="route-result" data-route={result.route_id}>
      <div className={styles.routeHead}>
        <h3 className={styles.routeName}>
          {route.name}
          <span className={styles.country}>{country}</span>
        </h3>
        {result.content_is_draft ? <Badge kind="draft" /> : null}
        <p className={styles.counts}>{t("elig.counts", { met: result.met, not: result.not_met, unknown: result.unknown })}</p>
      </div>
      <details className={styles.details}>
        <summary className={styles.summary}>{t("elig.details")}</summary>
        <ul className={styles.items}>
          {result.items.map((item) => {
            const req = raw.requirements.find((r) => r.id === item.requirement_id);
            const title = req ? localized(req, locale).title : item.title;
            const look = STATUS_LOOK[item.status];
            const why = words(item, req ? localized(req, locale).description : item.explanation);
            return (
              <li key={item.requirement_id} className={styles.item} data-status={item.status}>
                <Chip tone={look.tone} icon={<look.Icon weight="fill" size={18} />}>
                  {t(`elig.status.${item.status}` as Key)}
                </Chip>
                <p className={styles.itemTitle}>{title}</p>
                <p lang={why.lang}>{why.text}</p>
                {item.sources.length ? <SourceList sources={item.sources} /> : null}
              </li>
            );
          })}
        </ul>
        {route.sources.length ? (
          <>
            <p className={styles.itemTitle}>{t("elig.official")}</p>
            <SourceList sources={route.sources} checked={route.last_verified} />
          </>
        ) : null}
      </details>
    </li>
  );
}

/** The reason for one requirement's status, in the reader's language when the dictionary has it. */
function useWhy(): (item: EligibilityItem, description: string) => { text: string; lang?: string } {
  const { t, has } = useI18n();
  return (item, description) => {
    if (item.why === "manual") return { text: [description, t("elig.why.manual")].filter(Boolean).join(" ") };
    const key = `elig.why.${item.why}`;
    if (!item.why || !has(key)) return { text: item.explanation, lang: "en" };
    const p: Record<string, string | number> = { ...(item.params ?? {}) };
    if (typeof p.field === "string" && has(`elig.field.${p.field}`)) p.field = t(`elig.field.${p.field}` as Key);
    if (typeof p.test === "string" && has(`elig.testname.${p.test}`)) p.test = t(`elig.testname.${p.test}` as Key);
    if (typeof p.min === "string" && has(`edu.${p.min}`)) p.min = t(`edu.${p.min}` as Key);
    if (typeof p.accepted === "string") p.accepted = p.accepted.split(", ").map((x) => (has(`elig.testname.${x}`) ? t(`elig.testname.${x}` as Key) : x)).join(", ");
    return { text: t(key as Key, p) };
  };
}
