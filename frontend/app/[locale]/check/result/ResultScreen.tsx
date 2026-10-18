"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconBriefcase, IconCheckCircle, IconFileMagnifyingGlass, IconMagnifyingGlass, IconMapTrifold, IconMegaphone, IconTranslate } from "@/components/icons";
import { PageHead, Screen, Section, StickyActions } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Badge, Chip } from "@/components/ui/Chips";
import { Fact, FactList } from "@/components/ui/Facts";
import { ListenButton } from "@/components/ui/ListenButton";
import { AiLine, ErrorNotice, Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { ReportSheet } from "@/components/ui/ReportSheet";
import { ConfirmDialog } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { SourceList } from "@/components/ui/SourceChip";
import { Stamp } from "@/components/ui/Stamp";
import { SeverityChip } from "@/components/ui/Verdict";
import { aiProvider } from "@/lib/ai-firebase";
import { translatePaper } from "@/lib/check-run";
import { papersFor } from "@/lib/check-session";
import { useJourney, useStore } from "@/lib/data";
import { useFlagWords, type FlagWords, type Words } from "@/lib/flag-text";
import { toBase64 } from "@/lib/files";
import { formatMoney, languageInfo, rich, useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { loadPack } from "@/lib/packs";
import { PROMPTS } from "@/lib/prompts";
import { useQueryParam } from "@/lib/query";
import { sampleById } from "@/lib/samples";
import { readLocal, writeLocal } from "@/lib/storage";
import type { StoredCheck } from "@/lib/store";
import type { CountryPack, ExtractedDocument, Flag, Money, RecruiterCheck, WorkerStatement } from "@/lib/types";
import styles from "./Result.module.css";

const SEEN_KEY = "pg.checkStampsSeen";

/** The stamp presses once, the first time this result is shown on this phone. */
function useFirstView(id: string | null, fresh: boolean): boolean {
  const [press, setPress] = useState(false);
  useEffect(() => {
    if (!id || !fresh) return;
    const seen = readLocal<string[]>(SEEN_KEY, []);
    if (seen.includes(id)) return;
    setPress(true);
    writeLocal(SEEN_KEY, [id, ...seen].slice(0, 50));
  }, [id, fresh]);
  return press;
}

const W = ({ words, as: Tag = "span", className }: { words: Words; as?: "span" | "p"; className?: string }) => (
  <Tag lang={words.lang} dir={words.lang ? "auto" : undefined} className={className}>
    {words.text}
  </Tag>
);

const moneyText = (m: Money | null | undefined) => (m ? `${formatMoney(m)}${m.period && m.period !== "once" ? ` / ${m.period}` : ""}` : null);

function FlagCard({ flag, words, documents }: { flag: Flag; words: FlagWords; documents: ExtractedDocument[] }) {
  const { t } = useI18n();
  const title = words.title(flag);
  const verify = words.verify(flag);
  // For hidden instructions, show what the paper says to the AI: that is the evidence.
  const quotes = flag.code === "HIDDEN_INSTRUCTIONS" ? documents.flatMap((d) => d.instructions_to_ai ?? []) : [];
  const evidence = flag.code === "HIDDEN_INSTRUCTIONS" && quotes.length ? [] : flag.evidence.filter((e) => e.field !== "confidence" && e.field !== "layout_hash");
  return (
    <li className={styles.flag} data-severity={flag.severity}>
      <div className={styles.flagHead}>
        <SeverityChip severity={flag.severity} />
        <h3>
          <W words={title} />
        </h3>
      </div>
      <W words={words.explanation(flag)} as="p" />
      {flag.code === "RECRUITER_NETWORK_RISK" && flag.explanation ? (
        <p className="small soft" lang="en" dir="auto">
          {flag.explanation}
        </p>
      ) : null}
      {evidence.length || quotes.length ? (
        <div className={styles.evidence}>
          <p className={styles.evidenceLabel}>{t("flag.found")}</p>
          <ul>
            {evidence.map((e, i) => (
              <li key={i}>
                <span className="soft">{words.evidenceLabel(e, documents)}: </span>
                <bdi lang={words.evidenceValue(e).lang}>{words.evidenceValue(e).text}</bdi>
              </li>
            ))}
            {quotes.map((q, i) => (
              <li key={`q${i}`}>
                <span className="soft">{t("result.quote")}: </span>
                <q lang="en" dir="auto">
                  {q}
                </q>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {verify ? (
        <p className="small">
          <span className="soft">{t("flag.verify")}: </span>
          <W words={verify} />
        </p>
      ) : null}
      <SourceList sources={flag.sources} />
    </li>
  );
}

function RecruiterPanel({ recruiter }: { recruiter: RecruiterCheck | null | undefined }) {
  const { t } = useI18n();
  if (!recruiter || recruiter.status === "not_checked") {
    return (
      <Panel title={t("verdict.recruiter")}>
        <p>{t("result.recruiter.none")}</p>
      </Panel>
    );
  }
  const tone = recruiter.status === "licensed_active" ? "ok" : recruiter.status === "ambiguous" ? "amber" : "red";
  const name = recruiter.match?.name ?? recruiter.query_name ?? recruiter.query_license ?? "";
  const licence = recruiter.match?.license_no ?? recruiter.query_license ?? null;
  return (
    <Panel title={t("verdict.recruiter")}>
      <p className={styles.agentName}>
        <bdi lang="en">{name}</bdi>
      </p>
      {licence ? (
        <p className="small">
          {rich(t("result.recruiter.licence"), {
            licence: (
              <bdi dir="ltr" lang="en">
                {licence}
              </bdi>
            ),
          })}
        </p>
      ) : null}
      {recruiter.match && recruiter.query_name && recruiter.match.name !== recruiter.query_name ? (
        <p className="small soft">{rich(t("result.recruiter.asked"), { name: <bdi lang="en">{recruiter.query_name}</bdi> })}</p>
      ) : null}
      <Chip tone={tone}>{t(`rstatus.${recruiter.status}` as Key)}</Chip>
      {recruiter.network_reasons.length ? (
        <div>
          <p className="small soft">{t("result.reasons")}</p>
          <ul className={styles.bullets} lang="en">
            {recruiter.network_reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {recruiter.list_is_sample ? <p className="small soft">{t("recruiter.sample")}</p> : null}
      {licence && recruiter.match ? (
        <Button variant="secondary" compact full={false} href={`/recruiters/view?licence=${encodeURIComponent(licence)}`}>
          {t("result.recruiter.view")}
        </Button>
      ) : null}
    </Panel>
  );
}

const yesNo = (v: boolean | null | undefined, t: (k: Key) => string) => (v === true ? t("common.yes") : v === false ? t("common.no") : t("result.notStated"));

function PaperFacts({ doc, index, check, onTranslate, translating, language }: { doc: ExtractedDocument; index: number; check: StoredCheck; onTranslate?: () => void; translating: boolean; language: string }) {
  const { t } = useI18n();
  const translation = check.translations?.[doc.doc_id];
  const contract = ["contract", "offer_letter"].includes(doc.doc_type);
  const rows: [string, string | null, boolean][] = [
    [t("field.employer_name"), doc.employer_name ?? null, true],
    [t("field.job_title"), doc.job_title ?? null, true],
    [t("field.salary"), moneyText(doc.salary), true],
    [t("field.visa_type"), doc.visa_type ?? null, true],
    [t("field.visa_occupation"), doc.visa_occupation ?? null, true],
    [t("field.weekly_hours"), doc.weekly_hours != null ? String(doc.weekly_hours) : null, true],
    [t("field.contract_months"), doc.contract_months != null ? String(doc.contract_months) : null, true],
    [t("field.recruiter_name"), doc.recruiter_name ?? null, true],
    [t("field.recruiter_license_no"), doc.recruiter_license_no ?? null, true],
    [t("field.recruiter_phone"), doc.recruiter_phones.length ? doc.recruiter_phones.join(", ") : null, true],
    [t("field.fee_amount"), moneyText(doc.fee_amount), true],
    [t("field.fee_account"), doc.fee_account ?? null, true],
  ];
  if (contract) {
    rows.push([t("field.accommodation_provided"), yesNo(doc.accommodation_provided, t), false]);
    rows.push([t("field.food_provided"), yesNo(doc.food_provided, t), false]);
    rows.push([t("field.medical_covered"), yesNo(doc.medical_covered, t), false]);
    rows.push([t("field.return_ticket_provided"), yesNo(doc.return_ticket_provided, t), false]);
    rows.push([t("field.passport_held_by_employer"), yesNo(doc.passport_held_by_employer, t), false]);
  }
  const shown = rows.filter(([, v]) => v);
  return (
    <div className={styles.paper}>
      <h3>{t("result.paper", { n: index + 1, type: t(`doc.type.${doc.doc_type}` as Key) })}</h3>
      {shown.length ? (
        <FactList>
          {shown.map(([label, value, fromPaper]) => (
            <Fact key={label} label={label}>
              {fromPaper ? <bdi lang="en">{value}</bdi> : value}
            </Fact>
          ))}
        </FactList>
      ) : null}
      {doc.employer_name ? <LookItUp name={doc.employer_name} address={doc.employer_address ?? null} /> : null}
      {doc.notable_clauses.length ? (
        <div>
          <p className={styles.evidenceLabel}>{t("field.notable_clauses")}</p>
          <ul className={styles.bullets} lang="en">
            {doc.notable_clauses.map((c, i) => (
              <li key={i}>
                <q>{c}</q>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {translation ? (
        <div className={styles.translation}>
          <div className={styles.translationHead}>
            <h4>{t("result.translation")}</h4>
            <Badge kind="aiTranslation" />
          </div>
          <p lang={translation.language} className={styles.translationText}>
            {translation.text}
          </p>
          <ListenButton text={translation.text} lang={translation.language} />
        </div>
      ) : onTranslate && doc.language && doc.language !== language ? (
        <Button variant="secondary" compact full={false} icon={<IconTranslate size={22} />} onClick={onTranslate} busy={translating}>
          {translating ? t("result.translating") : t("result.translate", { language: languageInfo(language).native })}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Plain Google Search and Maps links for the employer or university named on the paper. In the
 * free build there is no grounding, so the person looks for themselves; the app does not judge
 * what they find.
 */
function LookItUp({ name, address }: { name: string; address: string | null }) {
  const { t } = useI18n();
  const search = `https://www.google.com/search?q=${encodeURIComponent(`"${name}"`)}`;
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address ? `${name}, ${address}` : name)}`;
  return (
    <div className={styles.lookup}>
      <p className={styles.evidenceLabel}>{t("result.lookup")}</p>
      <p className="small soft">{t("result.lookup.help")}</p>
      <div className={styles.lookupLinks}>
        <Button variant="secondary" compact full={false} href={search} external icon={<IconMagnifyingGlass size={20} />} data-testid="lookup-search">
          {t("result.lookup.search")}
        </Button>
        <Button variant="secondary" compact full={false} href={map} external icon={<IconMapTrifold size={20} />} data-testid="lookup-map">
          {t("result.lookup.map")}
        </Button>
      </div>
    </div>
  );
}

function StatementFacts({ statement }: { statement: WorkerStatement }) {
  const { t } = useI18n();
  const rows: [string, string | null][] = [
    [t("field.promised_salary"), moneyText(statement.promised_salary)],
    [t("field.promised_job_title"), statement.promised_job_title ?? null],
    [t("field.recruiter_name"), statement.recruiter_name ?? null],
    [t("field.recruiter_license_no"), statement.recruiter_license_no ?? null],
    [t("field.recruiter_phone"), statement.recruiter_phone ?? null],
    [t("field.fee_asked"), moneyText(statement.fee_asked)],
    [t("field.fee_paid_cash_only"), statement.fee_paid_cash_only === true ? t("common.yes") : null],
    [t("field.receipt_given"), statement.receipt_given === false ? t("common.no") : statement.receipt_given === true ? t("common.yes") : null],
  ];
  const shown = rows.filter(([, v]) => v);
  return (
    <div className={styles.paper}>
      <h3>{t("result.said")}</h3>
      {statement.transcript ? (
        <blockquote className={styles.quote} lang={statement.language ?? undefined} dir="auto">
          {statement.transcript}
        </blockquote>
      ) : null}
      {shown.length ? (
        <FactList>
          {shown.map(([label, value]) => (
            <Fact key={label} label={label}>
              <bdi lang="en">{value}</bdi>
            </Fact>
          ))}
        </FactList>
      ) : null}
    </div>
  );
}

function Result({ check, onChange }: { check: StoredCheck; onChange: (c: StoredCheck) => void }) {
  const { t, locale, date } = useI18n();
  const { store } = useStore();
  const journey = useJourney();
  const fresh = useQueryParam("new") === "1";
  const press = useFirstView(check.check_id, fresh);
  const [origin, setOrigin] = useState<CountryPack | null>(null);
  const [report, setReport] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [translating, setTranslating] = useState<string | null>(null);
  const [translateFailed, setTranslateFailed] = useState(false);
  const words = useFlagWords(origin);
  const ai = aiProvider();
  const files = papersFor(check.check_id);
  const sample = sampleById(check.sample_id);

  useEffect(() => {
    let cancelled = false;
    void loadPack(check.context?.origin_country ?? null).then((p) => !cancelled && setOrigin(p));
    return () => {
      cancelled = true;
    };
  }, [check.context?.origin_country]);

  const level = check.level;
  const titles = check.flags.filter((f) => f.severity === "high" || f.severity === "medium").slice(0, 3).map((f) => words.title(f));
  const steps = words.nextSteps(check.next_step_codes, check.next_steps);
  // Explanations and translations come in the person's AI answer language (Settings), which can
  // differ from the language of the screens.
  const aiLanguage = journey.settings.ai_language ?? locale;
  const summary: Words =
    check.spoken_summary && check.summary_language === aiLanguage
      ? { text: check.spoken_summary, lang: aiLanguage !== locale ? aiLanguage : undefined }
      : { text: [t(`verdict.${level}Lead` as Key), titles.length ? t("result.problems", { list: titles.map((w) => w.text).join(locale === "ur" ? "، " : ", ") }) : ""].filter(Boolean).join(" ") };
  const heading = t(`verdict.${level}` as Key);
  const spoken = [heading, summary.text, ...steps.map((s) => s.text)].join(". ");
  const firstDoc = check.documents[0];

  const translate = async (doc: ExtractedDocument, index: number) => {
    const file = files?.[index];
    if (!file || !store) return;
    setTranslating(doc.doc_id);
    setTranslateFailed(false);
    const out = await translatePaper(file, { ai, prompts: PROMPTS, toBase64, language: aiLanguage });
    setTranslating(null);
    if (!out.ok) return setTranslateFailed(true);
    const next: StoredCheck = { ...check, translations: { ...(check.translations ?? {}), [doc.doc_id]: { language: aiLanguage, text: out.value, model: out.model } } };
    onChange(next);
    await store.saveCheck(next).catch(() => undefined);
  };

  const clear = async () => {
    if (!store) return;
    const next = { ...check, cleared_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    await store.saveCheck(next);
    onChange(next);
    setConfirmClear(false);
    await journey.refreshChecks();
  };

  const canReport = level !== "green" || Boolean(check.recruiter?.query_name || check.recruiter?.query_license);

  return (
    <>
      <div className={styles.card} data-level={level}>
        <div className={styles.cardText}>
          {sample ? <Badge kind="sample" /> : null}
          <p className={styles.cardType}>{firstDoc ? t(`doc.type.${firstDoc.doc_type}` as Key) : t("result.said")}</p>
          {firstDoc?.employer_name ? (
            <p className="soft">
              <bdi lang="en">{firstDoc.employer_name}</bdi>
            </p>
          ) : null}
          {firstDoc?.salary ? (
            <p className="soft">
              <bdi dir="ltr">{moneyText(firstDoc.salary)}</bdi>
            </p>
          ) : null}
        </div>
        <div className={styles.cardFoot}>
          <Stamp
            level={level}
            size="md"
            seed={check.check_id}
            press={press}
            word={t(`stamp.${level}` as Key)}
            line={t(`stamp.${level}.line` as Key)}
            label={t("stamp.label", { word: t(`stamp.${level}` as Key), line: t(`stamp.${level}.line` as Key) })}
            className={styles.stamp}
          />
        </div>
      </div>

      <PageHead title={heading}>
        <p className="small soft">{t("result.when", { date: date(check.created_at, true) })}</p>
      </PageHead>

      {titles.length ? (
        <ul className={styles.reasons}>
          {titles.map((w, i) => (
            <li key={i}>
              <W words={w} />
            </li>
          ))}
        </ul>
      ) : null}

      {check.source === "ai" ? <AiLine /> : <p className={styles.source}>{t(check.source === "sample" && !check.model ? "result.prepared" : check.source === "sample" ? "ai.line" : "result.typed")}</p>}
      {sample ? <p className="small soft">{t("result.sample")}</p> : null}
      {check.ai_failure && check.ai_failure !== "cancelled" ? (
        <Notice kind="warning">
          <p>{t(`result.ai.${check.ai_failure}` as Key)}</p>
        </Notice>
      ) : null}
      {check.cleared_at ? (
        <Notice kind="success">
          <p>{t("result.cleared", { date: date(check.cleared_at) })}</p>
        </Notice>
      ) : null}

      <Section title={t("verdict.summary")} id="result-summary">
        <W words={summary} as="p" />
        <ListenButton text={spoken} />
      </Section>

      <Section title={t("verdict.found")} id="result-found">
        {check.flags.length ? (
          <ul className={styles.flags}>
            {check.flags.map((f, i) => (
              <FlagCard key={`${f.code}-${i}`} flag={f} words={words} documents={check.documents} />
            ))}
          </ul>
        ) : (
          <p>{t("verdict.none")}</p>
        )}
      </Section>

      <Section title={t("verdict.next")} id="result-next">
        <ol className={styles.steps}>
          {steps.map((s, i) => (
            <li key={i}>
              <IconCheckCircle size={24} className={styles.stepIcon} />
              <W words={s} />
            </li>
          ))}
        </ol>
      </Section>

      <RecruiterPanel recruiter={check.recruiter} />

      {check.documents.length || check.statement ? (
        <Section title={t("verdict.read")} id="result-read">
          {check.documents.map((d, i) => (
            <PaperFacts key={d.doc_id} doc={d} index={i} check={check} language={aiLanguage} translating={translating === d.doc_id} onTranslate={ai.enabled && files?.[i] ? () => void translate(d, i) : undefined} />
          ))}
          {translateFailed ? (
            <Notice kind="error">
              <p>{t("result.translate.failed")}</p>
            </Notice>
          ) : null}
          {ai.enabled && !files && check.source === "ai" && !check.translations ? <p className="small soft">{t("result.translate.again")}</p> : null}
          {check.statement ? <StatementFacts statement={check.statement} /> : null}
        </Section>
      ) : null}

      {check.content_is_draft ? (
        <Notice kind="warning">
          <p>{t("verdict.draftNote")}</p>
        </Notice>
      ) : null}
      <p className="small soft">{t("verdict.disclaimer")}</p>

      <div className={styles.more}>
        {canReport ? (
          <Button variant="secondary" full icon={<IconMegaphone size={22} />} onClick={() => setReport(true)} data-testid="report">
            {t("verdict.report")}
          </Button>
        ) : null}
        {level === "red" && !check.cleared_at && check.source !== "sample" ? (
          <Button variant="secondary" full icon={<IconCheckCircle size={22} />} onClick={() => setConfirmClear(true)} data-testid="clear">
            {t("result.clear")}
          </Button>
        ) : null}
        {level === "red" ? (
          <Button variant="secondary" full href="/check" icon={<IconFileMagnifyingGlass size={22} />}>
            {t("verdict.again")}
          </Button>
        ) : null}
      </div>

      <StickyActions>
        {level === "red" ? (
          <Button href={`/cases/new?check=${encodeURIComponent(check.check_id)}`} icon={<IconBriefcase size={24} />} data-testid="open-case">
            {t("result.openCase")}
          </Button>
        ) : (
          <Button href="/check" icon={<IconFileMagnifyingGlass weight="fill" size={24} />} data-testid="check-again">
            {t("verdict.again")}
          </Button>
        )}
      </StickyActions>

      <ReportSheet
        open={report}
        onClose={() => setReport(false)}
        recruiter={{ name: check.recruiter?.match?.name ?? check.recruiter?.query_name ?? null, license: check.recruiter?.match?.license_no ?? check.recruiter?.query_license ?? null }}
        checkId={check.check_id}
      />
      <ConfirmDialog open={confirmClear} title={t("result.clear.title")} body={<p>{t("result.clear.body")}</p>} confirmLabel={t("result.clear")} onConfirm={() => void clear()} onCancel={() => setConfirmClear(false)} />
    </>
  );
}

/** The stamped result of one check. */
export function ResultScreen() {
  const { t } = useI18n();
  const { store, failed } = useStore();
  const id = useQueryParam("id");
  const [state, setState] = useState<{ status: "loading" | "ready" | "missing" | "error"; check: StoredCheck | null }>({ status: "loading", check: null });

  const load = useCallback(() => {
    if (!store || !id) return;
    setState({ status: "loading", check: null });
    store
      .getCheck(id)
      .then((check) => setState({ status: check ? "ready" : "missing", check }))
      .catch(() => setState({ status: "error", check: null }));
  }, [store, id]);
  useEffect(load, [load]);

  const body = useMemo(() => {
    if (!id) return <Notice kind="info" action={t("verdict.again")} actionHref="/check"><p>{t("verdict.notFound")}</p></Notice>;
    if (failed || state.status === "error") return <ErrorNotice kind="load" onRetry={load} />;
    if (state.status === "loading") return <Skeleton block lines={5} label={t("common.loading")} />;
    if (state.status === "missing" || !state.check)
      return (
        <Notice kind="info" action={t("verdict.again")} actionHref="/check">
          <p>{t("verdict.notFound")}</p>
        </Notice>
      );
    return <Result check={state.check} onChange={(check) => setState({ status: "ready", check })} />;
  }, [id, failed, state, load, t]);

  return (
    <Screen tab="check" back={{ href: "/check", label: t("check.title") }}>
      {body}
    </Screen>
  );
}
