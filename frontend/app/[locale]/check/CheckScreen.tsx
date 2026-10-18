"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconCaretRight, IconFileMagnifyingGlass, IconFlask } from "@/components/icons";
import { PageHead, Screen, Section, StickyActions } from "@/components/shell/Screen";
import { Badge } from "@/components/ui/Chips";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Select, TextArea, TextInput } from "@/components/ui/Field";
import { MoneyInput, moneyFrom, type MoneyValue } from "@/components/ui/MoneyInput";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { PaperPicker } from "@/components/ui/PaperPicker";
import { RunSteps, type RunStep } from "@/components/ui/RunSteps";
import { Sheet } from "@/components/ui/Sheet";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { VerdictChip } from "@/components/ui/Verdict";
import { VoiceNote } from "@/components/ui/VoiceNote";
import type { AiFailure } from "@/lib/ai";
import { aiProvider } from "@/lib/ai-firebase";
import type { Recorder } from "@/lib/audio";
import { useAuth } from "@/lib/auth";
import { CheckCancelled, NothingRead, runCheck, type CheckFile, type RunProgress, type Stage } from "@/lib/check-run";
import { rememberPapers } from "@/lib/check-session";
import { useJourney, useStore } from "@/lib/data";
import { layoutHash } from "@/lib/engine/forensics";
import { coerceStatement, DOC_TYPES } from "@/lib/engine/reading";
import { randomId } from "@/lib/engine/text";
import { samplePaper, toBase64, type PaperFile } from "@/lib/files";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { useLabels } from "@/lib/labels";
import { PACK_INDEX, indexEntry, loadPack } from "@/lib/packs";
import { PROMPTS } from "@/lib/prompts";
import { recruiterDirectory } from "@/lib/recruiter-list";
import { SAMPLES, sampleTitle, type Sample } from "@/lib/samples";
import type { StoredCheck } from "@/lib/store";
import type { ExtractedDocument, WorkerStatement } from "@/lib/types";
import styles from "./Check.module.css";

type Purpose = "work" | "study" | "visit";

interface Details {
  salary: MoneyValue;
  job: string;
  recruiter: string;
  licence: string;
  phone: string;
  fee: MoneyValue;
  cashOnly: boolean;
  noReceipt: boolean;
}

interface PaperForm {
  type: string;
  employer: string;
  job: string;
  salary: MoneyValue;
  visa: string;
  hours: string;
  passport: boolean;
  accommodation: boolean;
  food: boolean;
  medical: boolean;
  ticket: boolean;
  recruiter: string;
  licence: string;
}

const STAGES: Stage[] = ["read", "listen", "agent", "rules", "explain", "save"];
const STAGE_KEY: Record<Stage, Key> = { read: "run.read", listen: "run.listen", agent: "run.agent", rules: "run.rules", explain: "run.explain", save: "run.save" };
const VISA_TYPES = ["work", "visit", "tourist", "umrah", "hajj", "transit", "family visit", "business visit", "residence", "student", "other"];

// Remembered for this tab: once the project's AI turned out to be switched off, start in the typed form.
let aiOffThisSession = false;

function statementFrom(d: Details): WorkerStatement | null {
  const s: WorkerStatement = {
    ...coerceStatement({}),
    promised_salary: moneyFrom(d.salary, "month"),
    promised_job_title: d.job.trim() || null,
    recruiter_name: d.recruiter.trim() || null,
    recruiter_license_no: d.licence.trim() || null,
    recruiter_phone: d.phone.trim() || null,
    fee_asked: moneyFrom(d.fee, "once"),
    fee_paid_cash_only: d.cashOnly ? true : null,
    receipt_given: d.noReceipt ? false : null,
  };
  const filled = Object.entries(s).some(([k, v]) => k !== "other_claims" && v !== null && v !== undefined);
  return filled ? s : null;
}

function paperFrom(f: PaperForm): ExtractedDocument | null {
  const salary = moneyFrom(f.salary, "month");
  const hours = Number(f.hours);
  const doc: ExtractedDocument = {
    doc_id: "typed",
    doc_type: f.type,
    employer_name: f.employer.trim() || null,
    job_title: f.job.trim() || null,
    salary,
    visa_type: f.visa || null,
    weekly_hours: f.hours.trim() && Number.isFinite(hours) && hours > 0 && hours <= 168 ? hours : null,
    // Unticked means "the paper does not say", never "no".
    passport_held_by_employer: f.passport ? true : null,
    accommodation_provided: f.accommodation ? true : null,
    food_provided: f.food ? true : null,
    medical_covered: f.medical ? true : null,
    return_ticket_provided: f.ticket ? true : null,
    recruiter_name: f.recruiter.trim() || null,
    recruiter_license_no: f.licence.trim() || null,
    recruiter_phones: [],
    notable_clauses: [],
    confidence: 1,
    injection_suspected: false,
  };
  const filled = doc.employer_name || doc.job_title || salary || doc.visa_type || doc.weekly_hours || f.passport || f.accommodation || f.food || f.medical || f.ticket || doc.recruiter_name || doc.recruiter_license_no;
  return filled ? doc : null;
}

const toCheckFile = (p: PaperFile): CheckFile => ({ name: p.name, mimeType: p.mimeType, data: p.data });

/** Check a paper: add photos or a voice note (or type the details), then get the stamp. */
export function CheckScreen() {
  const { t, href, locale } = useI18n();
  const labels = useLabels();
  const router = useRouter();
  const auth = useAuth();
  const { store } = useStore();
  const journey = useJourney();
  const ai = aiProvider();

  const answers = journey.plan?.answers ?? null;
  const [trip, setTrip] = useState<{ origin: string; destination: string; purpose: Purpose }>({ origin: "", destination: "", purpose: "work" });
  const [editTrip, setEditTrip] = useState(false);
  const tripFromJourney = useRef(false);
  useEffect(() => {
    if (tripFromJourney.current || journey.status === "loading") return;
    tripFromJourney.current = true;
    if (answers) setTrip({ origin: answers.origin ?? "", destination: answers.destination ?? "", purpose: answers.purpose === "study" ? "study" : "work" });
    else setEditTrip(true);
  }, [journey.status, answers]);

  const currencyOf = (code: string, fallback: string) => indexEntry(code)?.currency ?? fallback;
  const [papers, setPapers] = useState<PaperFile[]>([]);
  const [voice, setVoice] = useState<Recorder["note"]>(null);
  const [text, setText] = useState("");
  const [details, setDetails] = useState<Details>({ salary: { amount: "", currency: "SAR" }, job: "", recruiter: "", licence: "", phone: "", fee: { amount: "", currency: "PKR" }, cashOnly: false, noReceipt: false });
  const [paper, setPaper] = useState<PaperForm>({ type: "offer_letter", employer: "", job: "", salary: { amount: "", currency: "SAR" }, visa: "", hours: "", passport: false, accommodation: false, food: false, medical: false, ticket: false, recruiter: "", licence: "" });
  // Amounts default to the currencies of the trip.
  useEffect(() => {
    const pay = currencyOf(trip.destination, "SAR");
    const fee = currencyOf(trip.origin, "PKR");
    setDetails((d) => (d.salary.amount || d.fee.amount ? d : { ...d, salary: { ...d.salary, currency: pay }, fee: { ...d.fee, currency: fee } }));
    setPaper((p) => (p.salary.amount ? p : { ...p, salary: { ...p.salary, currency: pay } }));
  }, [trip.destination, trip.origin]);

  // Sharing warnings starts from the person's setting, and can be changed for this one check.
  const [share, setShare] = useState(false);
  useEffect(() => setShare(journey.settings.share_signals), [journey.settings.share_signals]);
  const aiLanguage = journey.settings.ai_language ?? locale;
  const [manual, setManual] = useState(!ai.enabled || aiOffThisSession);
  const [problem, setProblem] = useState<{ kind: "needSomething" | "failed" | "stopped" | "nothingRead"; reason?: AiFailure } | null>(null);
  const [running, setRunning] = useState<RunProgress | null>(null);
  const [sampleSheet, setSampleSheet] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const [checks, setChecks] = useState<StoredCheck[] | null>(null);
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store
      .listChecks()
      .then((list) => !cancelled && setChecks(list))
      .catch(() => !cancelled && setChecks([]));
    return () => {
      cancelled = true;
    };
  }, [store]);

  const onVoice = useCallback((note: Recorder["note"]) => setVoice(note), []);

  const go = async (sample: Sample | null) => {
    if (!store) return;
    setProblem(null);
    setSampleSheet(false);
    const typed = sample ? null : statementFrom(details);
    const typedPaper = !sample && manual ? paperFrom(paper) : null;
    if (!sample && !papers.length && !voice && !text.trim() && !typed && !typedPaper) {
      setProblem({ kind: "needSomething" });
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setRunning({ stage: "read" });
    window.scrollTo(0, 0);
    try {
      const files = sample ? await Promise.all(sample.documents.map((d) => samplePaper(d.image, d.mime_type))) : papers;
      const context = sample
        ? { origin_country: sample.context.origin, destination_country: sample.context.destination, purpose: sample.context.purpose, reply_language: aiLanguage }
        : { origin_country: trip.origin, destination_country: trip.destination || null, purpose: trip.purpose, reply_language: aiLanguage };
      const checkFiles = files.map(toCheckFile);
      const { check } = await runCheck(
        {
          files: manual && !sample ? [] : checkFiles,
          voice: manual || sample || !voice ? null : { name: "voice.wav", mimeType: "audio/wav", data: voice.wav },
          text: sample ? (sample.statement?.text ?? "") : manual ? "" : text,
          typed,
          paper: typedPaper,
          context,
          sample,
          shareSignals: share && !sample,
        },
        {
          ai,
          prompts: PROMPTS,
          store,
          loadPack,
          directory: recruiterDirectory,
          layoutHash,
          toBase64,
          now: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
          newId: () => randomId("chk", 8),
          language: aiLanguage,
          onProgress: setRunning,
          signal: abort.signal,
        },
      );
      rememberPapers(check.check_id, checkFiles);
      // The journey step "check your offer" is done once a person has checked their own paper.
      if (!sample && journey.plan) {
        const step = journey.plan.items.find((i) => i.app === "checkOffer" || i.app === "checkAdmission");
        if (step && journey.journey?.items[step.id]?.status !== "done") await journey.setStatus(step.id, "done");
      }
      await journey.refreshChecks();
      router.push(href(`/check/result?id=${encodeURIComponent(check.check_id)}&new=1`));
    } catch (error) {
      setRunning(null);
      if (error instanceof CheckCancelled) setProblem({ kind: "stopped" });
      else if (error instanceof NothingRead) {
        if (error.reason === "off") aiOffThisSession = true;
        setManual(true);
        setProblem({ kind: "nothingRead", reason: error.reason });
      } else setProblem({ kind: "failed" });
    }
  };

  // ---- running ----
  if (running) {
    const at = STAGES.indexOf(running.stage);
    const steps: RunStep[] = STAGES.filter((s) => s !== "explain" || ai.enabled).map((s) => ({
      id: s,
      label: s === "read" && running.stage === "read" && (running.total ?? 0) > 1 ? t("run.readN", { n: running.index ?? 1, total: running.total ?? 1 }) : t(STAGE_KEY[s]),
      state: STAGES.indexOf(s) < at ? "done" : s === running.stage ? "doing" : "todo",
    }));
    return (
      <Screen tab="check" bar={false}>
        <PageHead title={t("run.title")} />
        <RunSteps steps={steps} />
        <StickyActions>
          <Button variant="secondary" full onClick={() => controller.current?.abort()} data-testid="stop">
            {t("run.stop")}
          </Button>
        </StickyActions>
      </Screen>
    );
  }

  // ---- the form ----
  const origins = PACK_INDEX.filter((p) => p.kind !== "destination").map((p) => ({ value: p.code, label: labels.country(p.code) ?? p.name }));
  const destinations = PACK_INDEX.filter((p) => p.kind !== "origin").map((p) => ({ value: p.code, label: labels.country(p.code) ?? p.name }));
  const purposeLabel = t(`purpose.${trip.purpose === "visit" ? "visit" : trip.purpose}` as Key);
  const setD = (patch: Partial<Details>) => setDetails((d) => ({ ...d, ...patch }));
  const setP = (patch: Partial<PaperForm>) => setPaper((p) => ({ ...p, ...patch }));

  const detailsFields = (
    <>
      <MoneyInput label={t("check.salary")} value={details.salary} onChange={(salary) => setD({ salary })} optional />
      <TextInput label={t("check.job")} value={details.job} onChange={(job) => setD({ job })} optional />
      <TextInput label={t("check.recruiter")} value={details.recruiter} onChange={(recruiter) => setD({ recruiter })} optional />
      <TextInput label={t("check.licence")} value={details.licence} onChange={(licence) => setD({ licence })} ltr mic={false} optional />
      <TextInput label={t("check.phone")} value={details.phone} onChange={(phone) => setD({ phone })} type="tel" inputMode="tel" ltr mic={false} optional />
      <MoneyInput label={t("check.fee")} value={details.fee} onChange={(fee) => setD({ fee })} optional />
      <div>
        <Checkbox checked={details.cashOnly} onChange={(cashOnly) => setD({ cashOnly })} label={t("check.cashOnly")} />
        <Checkbox checked={details.noReceipt} onChange={(noReceipt) => setD({ noReceipt })} label={t("check.noReceipt")} />
      </div>
    </>
  );

  return (
    <Screen tab="check">
      <PageHead title={t("check.title")} lead={t("check.lead")} />

      {editTrip ? (
        <Section title={t("check.step1")} id="check-trip">
          <Select label={t("check.from")} value={trip.origin} onChange={(origin) => setTrip((x) => ({ ...x, origin }))} options={origins} placeholder={t("start.from.other")} />
          <Select label={t("check.country")} value={trip.destination} onChange={(destination) => setTrip((x) => ({ ...x, destination }))} options={destinations} placeholder={t("check.notSure")} />
          <Select
            label={t("check.purpose")}
            value={trip.purpose}
            onChange={(purpose) => setTrip((x) => ({ ...x, purpose: purpose as Purpose }))}
            options={(["work", "study", "visit"] as const).map((p) => ({ value: p, label: t(`purpose.${p}` as Key) }))}
          />
        </Section>
      ) : (
        <div className={styles.trip}>
          <p>
            {trip.destination ? t("check.for", { from: labels.country(trip.origin) ?? t("start.from.other"), to: labels.country(trip.destination) ?? "" }) : t("check.notSure")}
            <br />
            <span className="small soft">{t("check.forPurpose", { purpose: purposeLabel })}</span>
          </p>
          <Button variant="quiet" full={false} compact onClick={() => setEditTrip(true)}>
            {t("check.change")}
          </Button>
        </div>
      )}

      <Panel title={t("check.sample.title")}>
        <p>{t("check.sample.lead")}</p>
        <Button variant="secondary" full={false} compact icon={<IconFlask size={22} />} onClick={() => setSampleSheet(true)} data-testid="try-sample">
          {t("check.sample")}
        </Button>
      </Panel>

      {problem?.kind === "nothingRead" ? (
        <Notice kind="warning" title={t("check.manual.title")}>
          <p>{problem.reason === "off" ? t("check.manual") : t(`result.ai.${problem.reason ?? "unreadable"}` as Key)}</p>
        </Notice>
      ) : null}

      {!manual ? (
        <>
          <Section title={t("check.papers")} id="check-papers">
            <p className="small soft">{t("check.papers.help", { n: 4 })}</p>
            <PaperPicker papers={papers} onChange={setPapers} />
            <p className={styles.notice}>{t("ai.freeTier")}</p>
          </Section>

          <Section title={t("check.step3")} id="check-promise">
            <p className="small soft">{t("check.step3help")}</p>
            <VoiceNote onChange={onVoice} />
            <TextArea label={t("check.statement")} placeholder={t("check.statementPh")} value={text} onChange={setText} rows={3} optional />
            <details className={styles.details}>
              <summary className={styles.summary}>{t("check.details")}</summary>
              <div className={styles.fields}>{detailsFields}</div>
            </details>
          </Section>
        </>
      ) : (
        <>
          {problem?.kind !== "nothingRead" ? (
            <Notice kind="info">
              <p>{t("check.manual")}</p>
            </Notice>
          ) : null}
          <Section title={t("check.paper")} id="check-paper">
            <p className="small soft">{t("check.paper.help")}</p>
            <Select
              label={t("check.paper.type")}
              value={paper.type}
              onChange={(type) => setP({ type })}
              options={DOC_TYPES.filter((d) => d !== "other").map((d) => ({ value: d, label: t(`doc.type.${d}` as Key) }))}
            />
            <TextInput label={t("check.paper.employer")} value={paper.employer} onChange={(employer) => setP({ employer })} optional />
            <TextInput label={t("check.paper.job")} value={paper.job} onChange={(job) => setP({ job })} optional />
            <MoneyInput label={t("check.paper.salary")} value={paper.salary} onChange={(salary) => setP({ salary })} optional />
            <Select label={t("check.paper.visa")} value={paper.visa} onChange={(visa) => setP({ visa })} options={VISA_TYPES.map((v) => ({ value: v, label: v }))} placeholder={t("common.unknown")} optional />
            <TextInput label={t("check.paper.hours")} value={paper.hours} onChange={(hours) => setP({ hours: hours.replace(/[^\d]/g, "") })} inputMode="numeric" ltr mic={false} optional />
            <TextInput label={t("check.paper.recruiter")} value={paper.recruiter} onChange={(recruiter) => setP({ recruiter })} optional />
            <TextInput label={t("check.paper.licence")} value={paper.licence} onChange={(licence) => setP({ licence })} ltr mic={false} optional />
            <fieldset className={styles.group}>
              <legend className={styles.legend}>{t("check.paper.gives")}</legend>
              <Checkbox checked={paper.accommodation} onChange={(accommodation) => setP({ accommodation })} label={t("field.accommodation_provided")} />
              <Checkbox checked={paper.food} onChange={(food) => setP({ food })} label={t("field.food_provided")} />
              <Checkbox checked={paper.medical} onChange={(medical) => setP({ medical })} label={t("field.medical_covered")} />
              <Checkbox checked={paper.ticket} onChange={(ticket) => setP({ ticket })} label={t("field.return_ticket_provided")} />
            </fieldset>
            <Checkbox checked={paper.passport} onChange={(passport) => setP({ passport })} label={t("check.paper.passport")} />
          </Section>
          <Section title={t("check.step3")} id="check-promise">
            {detailsFields}
          </Section>
        </>
      )}

      {store?.kind === "firestore" ? (
        <Checkbox checked={share} onChange={setShare} label={t("check.step4")} hint={t("check.share")} />
      ) : auth.canSignIn ? (
        <p className="small soft">{t("check.signin.share")}</p>
      ) : null}

      {problem?.kind === "failed" ? (
        <Notice kind="error" title={t("error.title")}>
          <p>{t("run.failed")}</p>
        </Notice>
      ) : null}
      {problem?.kind === "stopped" ? (
        <Notice kind="info">
          <p>{t("run.stopped")}</p>
        </Notice>
      ) : null}

      <StickyActions>
        {problem?.kind === "needSomething" ? (
          <p className={styles.pick} role="alert">
            {t("check.needSomething")}
          </p>
        ) : null}
        <Button onClick={() => void go(null)} icon={<IconFileMagnifyingGlass weight="fill" size={24} />} disabled={!store} data-testid="check-now">
          {t("check.submit")}
        </Button>
      </StickyActions>

      <Section title={t("check.mine")} id="check-mine">
        {checks === null ? null : checks.length ? (
          <ul className={styles.past}>
            {checks.map((c) => (
              <PastCheck key={c.check_id} check={c} />
            ))}
          </ul>
        ) : (
          <p className="soft">{t("check.none")}</p>
        )}
      </Section>

      <Sheet open={sampleSheet} onClose={() => setSampleSheet(false)} title={t("check.sample.pick")}>
        <p>{t("check.sample.lead")}</p>
        <ul className={styles.samples}>
          {SAMPLES.map((s) => {
            const title = sampleTitle(s, locale);
            return (
              <li key={s.id}>
                <button type="button" className={styles.sample} onClick={() => void go(s)} data-testid={`sample-${s.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.documents[0].image} alt="" className={styles.sampleThumb} />
                  <span className={styles.sampleText}>
                    <span className={styles.sampleTitle} lang={title.lang}>
                      {title.text}
                    </span>
                    <span className="small soft">{t("journey.route", { from: labels.country(s.context.origin) ?? "", to: labels.country(s.context.destination) ?? "" })}</span>
                    <Badge kind="sample" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Sheet>
    </Screen>
  );
}

/** One earlier check: its stamp word, what was checked, and when. */
function PastCheck({ check }: { check: StoredCheck }) {
  const { t, date, locale } = useI18n();
  const doc = check.documents[0];
  const sample = check.sample_id ? SAMPLES.find((s) => s.id === check.sample_id) : null;
  const sampleName = sample ? sampleTitle(sample, locale) : null;
  const title = sampleName ? sampleName.text : doc ? t(`doc.type.${doc.doc_type}` as Key) : t("check.title");
  return (
    <li>
      <LocaleLink href={`/check/result?id=${encodeURIComponent(check.check_id)}`} className={styles.pastRow}>
        <span className={styles.pastText}>
          <VerdictChip level={check.level} />
          <span className={styles.pastTitle} lang={sampleName?.lang}>
            {title}
            {!sample && doc?.employer_name ? (
              <>
                {": "}
                <bdi lang="en">{doc.employer_name}</bdi>
              </>
            ) : null}
          </span>
          <span className="small soft">
            {t("result.when", { date: date(check.created_at) })}
            {sample ? ` (${t("badge.sample")})` : ""}
          </span>
        </span>
        <IconCaretRight weight="bold" size={20} directional className={styles.chevron} />
      </LocaleLink>
    </li>
  );
}

