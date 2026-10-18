"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconCheck, IconCheckCircle, IconFlask, IconHourglass, IconPencilSimpleLine, IconPlus, IconWarning, IconX } from "@/components/icons";
import { passportGuide, passportSources } from "@/components/shell/JourneyPassport";
import { PageHead, Screen, Section, StickyActions } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Chips";
import { Select, TextInput } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { AddPaperButtons } from "@/components/ui/PaperPicker";
import { PassportStatus } from "@/components/ui/PassportStatus";
import { ConfirmDialog } from "@/components/ui/Sheet";
import { aiProvider } from "@/lib/ai-firebase";
import { useJourney } from "@/lib/data";
import { PAPER_KINDS, cleanName, isoDate, localToday, summarizeReadiness, type IdentityReading, type NameMatch } from "@/lib/engine/readiness";
import { randomId } from "@/lib/engine/text";
import { addPapers, releasePaper, toBase64, type FileProblem } from "@/lib/files";
import { formatList, rich, useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { PROMPTS } from "@/lib/prompts";
import { readIdentityPaper } from "@/lib/readiness-run";
import { isSampleReading, readinessSample } from "@/lib/samples";
import styles from "./Scan.module.css";

/** Enough for a passport, an ID card and the certificates and letters of one application. */
const MAX_SCAN_PAPERS = 8;

const FILE_PROBLEM: Record<FileProblem, Key> = { unsupported: "file.unsupported", tooLarge: "file.tooLarge", tooMany: "scan.limit" };
const NAME_ICON: Record<NameMatch, typeof IconCheckCircle> = { same: IconCheckCircle, order: IconWarning, different: IconWarning };

const blankPaper = (kind: IdentityReading["kind"]): IdentityReading => ({ id: randomId("pap", 6), kind, full_name: null, expiry_date: null, source: "typed", confidence: 1 });
const isEmpty = (p: IdentityReading) => !p.full_name && !p.expiry_date;
const nextKind = (list: IdentityReading[]): IdentityReading["kind"] => (list.some((p) => p.kind === "passport") ? "other" : "passport");
/** A sample is replaced as a whole by the person's own first paper. */
const ownPapers = (list: IdentityReading[]) => (list.some(isSampleReading) ? [] : list);

/** Are the papers ready? Photos (or typed details) in; months left on the passport and name spellings out. */
export function ScanScreen() {
  const { t, date, locale } = useI18n();
  const journey = useJourney();
  const ai = aiProvider();
  const today = localToday();

  // ---- the papers on screen: the saved results at first ----
  const [papers, setPapers] = useState<IdentityReading[]>([]);
  const [dirty, setDirty] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || journey.status === "loading") return;
    loaded.current = true;
    if (journey.readiness?.papers.length) setPapers(journey.readiness.papers);
  }, [journey.status, journey.readiness]);
  const sample = papers.some(isSampleReading);

  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [readingCount, setReadingCount] = useState(0);
  const [rowProblem, setRowProblem] = useState<Record<string, Key>>({});
  const [fileProblem, setFileProblem] = useState<FileProblem | null>(null);
  const [outcome, setOutcome] = useState<"saved" | "deleted" | "failed" | "nothing" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const touched = () => {
    setDirty(true);
    setOutcome(null);
  };
  const setOpen = (id: string, open: boolean) =>
    setEditing((s) => {
      const next = new Set(s);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  const edit = (id: string, patch: Partial<IdentityReading>) => {
    setPapers((list) => list.map((p) => (p.id === id ? { ...p, ...patch, source: isSampleReading(p) ? p.source : "typed" } : p)));
    touched();
  };
  const remove = (id: string) => {
    setPapers((list) => list.filter((p) => p.id !== id));
    setRowProblem(({ [id]: _gone, ...rest }) => rest);
    setOpen(id, false);
    touched();
  };
  const append = (paper: IdentityReading | null, problem?: Key) => {
    const blank = blankPaper("other");
    setPapers((list) => {
      const own = ownPapers(list);
      return [...own, paper ?? { ...blank, kind: nextKind(own) }];
    });
    if (!paper) {
      setOpen(blank.id, true);
      if (problem) setRowProblem((r) => ({ ...r, [blank.id]: problem }));
    }
    touched();
  };
  const loadSample = () => {
    setPapers(readinessSample(today));
    setEditing(new Set());
    setRowProblem({});
    touched();
  };
  const clearSample = () => {
    setPapers([]);
    setEditing(new Set());
    touched();
  };

  const room = MAX_SCAN_PAPERS - ownPapers(papers).length;
  const typeIn = () => (room > 0 ? append(null) : setFileProblem("tooMany"));

  // ---- reading photos: one at a time, each photo forgotten once read ----
  const pick = async (files: File[]) => {
    setFileProblem(null);
    const { added, problem } = await addPapers(files.slice(0, Math.max(0, room)), []);
    setFileProblem(files.length > room ? "tooMany" : problem);
    if (!added.length) return;
    const abort = new AbortController();
    controller.current = abort;
    for (const file of added) {
      setReadingCount((n) => n + 1);
      const out = await readIdentityPaper(file, { ai, prompts: PROMPTS, toBase64, newId: () => randomId("pap", 6), signal: abort.signal });
      releasePaper(file);
      setReadingCount((n) => n - 1);
      if (abort.signal.aborted) return;
      if (out.ok) append(out.reading);
      else append(null, `scan.ai.${out.reason === "cancelled" ? "unreadable" : out.reason}` as Key);
    }
  };

  // ---- what the papers say, worked out by code ----
  const route = journey.destination?.visa_routes.find((r) => r.id === journey.journey?.answers.route_id) ?? null;
  const routeName = journey.plan?.route?.name ?? null;
  const filled = useMemo(() => papers.filter((p) => !isEmpty(p)), [papers]);
  const summary = useMemo(() => summarizeReadiness(filled, route, today), [filled, route, today]);
  const kindName = (p: IdentityReading) => t(`scan.kind.${p.kind}` as Key);
  const base = summary.names[0]?.a ?? null;

  const save = async () => {
    if (!filled.length) return setOutcome("nothing");
    setBusy(true);
    const ok = await journey.saveReadiness({ scanned_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), papers: filled });
    setBusy(false);
    if (!ok) return setOutcome("failed");
    setPapers(filled);
    setEditing(new Set());
    setDirty(false);
    setOutcome("saved");
    // Scanning the papers is a step of the journey.
    const step = journey.plan?.items.find((i) => i.app === "readiness");
    if (step && journey.journey?.items[step.id]?.status !== "done") await journey.setStatus(step.id, "done");
  };

  const deleteAll = async () => {
    setBusy(true);
    const ok = await journey.saveReadiness(null);
    setBusy(false);
    setConfirmDelete(false);
    if (!ok) return setOutcome("failed");
    setPapers([]);
    setEditing(new Set());
    setDirty(false);
    setOutcome("deleted");
  };

  return (
    <Screen tab="journey" back={{ href: "/documents", label: t("docs.title") }}>
      <PageHead title={t("app.readiness")} lead={t("scan.lead")} />

      {sample ? (
        <Notice kind="info" action={t("scan.sample.clear")} onAction={clearSample}>
          <p>
            <Badge kind="sample" /> {t("scan.sample.on")}
          </p>
        </Notice>
      ) : !papers.length ? (
        <Panel title={t("scan.sample.title")}>
          <p>{t("scan.sample.lead")}</p>
          <Button variant="secondary" full={false} compact icon={<IconFlask size={22} />} onClick={loadSample} data-testid="try-sample">
            {t("scan.sample")}
          </Button>
        </Panel>
      ) : null}

      {!ai.enabled && !sample ? (
        <Notice kind="info">
          <p>{t("scan.manual")}</p>
        </Notice>
      ) : null}

      <Section title={t("scan.papers")} id="scan-papers">
        <p className="small soft">{t("scan.papers.help")}</p>
        {papers.length ? (
          <ol className={styles.papers}>
            {papers.map((p, i) => (
              <PaperRow key={p.id} paper={p} n={i + 1} open={editing.has(p.id)} problem={rowProblem[p.id] ?? null} onOpen={(open) => setOpen(p.id, open)} onEdit={(patch) => edit(p.id, patch)} onRemove={() => remove(p.id)} />
            ))}
          </ol>
        ) : null}
        {readingCount > 0 ? (
          <p className={styles.reading} role="status">
            <IconHourglass size={24} className={styles.wait} />
            {t("scan.reading", { n: ownPapers(papers).length + 1 })}
          </p>
        ) : null}

        {ai.enabled ? <AddPaperButtons onPick={(files) => void pick(files)} disabled={readingCount > 0 || room <= 0} /> : null}
        <Button variant={ai.enabled ? "quiet" : "secondary"} full={!ai.enabled} icon={<IconPlus size={22} />} onClick={typeIn} disabled={readingCount > 0} data-testid="type-in">
          {t("scan.add")}
        </Button>
        {fileProblem ? (
          <p className={styles.problem} role="alert">
            {t(FILE_PROBLEM[fileProblem], { n: MAX_SCAN_PAPERS })}
          </p>
        ) : null}
        {ai.enabled ? <p className={styles.notice}>{t("ai.freeTier")}</p> : null}
      </Section>

      {filled.length ? (
        <Section title={t("scan.found")} id="scan-found">
          <PassportStatus check={summary.passport} route={routeName} today={today} sources={passportSources(route)} guideHref={passportGuide(journey.origin)} calendar={!sample} level={3} />

          <div className={styles.names}>
            <h3>{t("scan.names")}</h3>
            {filled.length < 2 ? (
              <p>{t("scan.names.one")}</p>
            ) : base ? (
              <>
                <p>
                  {rich(base.kind === "passport" ? t("scan.names.base") : t("scan.names.baseOther", { paper: kindName(base) }), {
                    name: (
                      <bdi className={styles.name} dir="ltr">
                        {base.full_name}
                      </bdi>
                    ),
                  })}
                </p>
                <ul className={styles.nameList}>
                  {summary.names.map((c) => {
                    const Icon = NAME_ICON[c.match];
                    return (
                      <li key={c.b.id} className={styles[`match-${c.match}`]} data-match={c.match}>
                        <Icon weight="fill" size={24} className={styles.nameIcon} />
                        <span className={styles.nameText}>
                          <span>
                            {kindName(c.b)}:{" "}
                            <bdi className={styles.name} dir="ltr">
                              {c.b.full_name}
                            </bdi>
                          </span>
                          <span className={styles.matchWords}>
                            {c.match === "same" ? (base.kind === "passport" ? t("scan.names.same") : t("scan.names.sameOther", { paper: kindName(base) })) : t(`scan.names.${c.match}` as Key)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {summary.names.some((c) => c.match === "different") ? <p className={styles.advice}>{t("scan.names.advice")}</p> : null}
                {summary.names.some((c) => c.match === "order") ? <p className={styles.advice}>{t("scan.names.orderAdvice")}</p> : null}
              </>
            ) : null}
            {summary.notCompared.length ? <p className="small soft">{t("scan.names.notCompared", { papers: formatList(locale, summary.notCompared.map(kindName)) })}</p> : null}
          </div>

          {summary.expired.length ? (
            <Notice kind="warning">
              {summary.expired.map((p) => (
                <p key={p.id}>{t("scan.expiredOther", { paper: kindName(p), date: date(p.expiry_date) })}</p>
              ))}
            </Notice>
          ) : null}
        </Section>
      ) : null}

      {outcome === "saved" ? (
        <Notice kind="success">
          <p>{t("scan.saved")}</p>
        </Notice>
      ) : outcome === "deleted" ? (
        <Notice kind="success">
          <p>{t("scan.deleted")}</p>
        </Notice>
      ) : outcome === "failed" ? (
        <Notice kind="error" title={t("error.title")}>
          <p>{t("error.save")}</p>
        </Notice>
      ) : null}

      {journey.readiness && !dirty && outcome !== "saved" ? <p className="small soft">{t("scan.savedOn", { date: date(journey.readiness.scanned_at) })}</p> : null}
      <p className="small soft">{t("scan.stored")}</p>
      {journey.readiness ? (
        <Button variant="quiet" full={false} onClick={() => setConfirmDelete(true)} data-testid="delete-results">
          {t("scan.delete")}
        </Button>
      ) : null}

      {!sample && papers.length && (dirty || !journey.readiness) ? (
        <StickyActions>
          {outcome === "nothing" ? (
            <p className={styles.problem} role="alert">
              {t("scan.nothing")}
            </p>
          ) : null}
          <Button onClick={() => void save()} busy={busy} icon={<IconCheck weight="bold" size={24} />} data-testid="save">
            {t("scan.save")}
          </Button>
        </StickyActions>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title={t("scan.delete.title")}
        body={<p>{t("scan.delete.lead")}</p>}
        confirmLabel={t("scan.delete")}
        danger
        busy={busy}
        onConfirm={() => void deleteAll()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

/** One paper: what was read from it in a few lines, or the form to correct it. */
function PaperRow({
  paper,
  n,
  open,
  problem,
  onOpen,
  onEdit,
  onRemove,
}: {
  paper: IdentityReading;
  n: number;
  open: boolean;
  problem: Key | null;
  onOpen: (open: boolean) => void;
  onEdit: (patch: Partial<IdentityReading>) => void;
  onRemove: () => void;
}) {
  const { t, date } = useI18n();
  const label = t("scan.paper", { n });
  const from = t(isSampleReading(paper) ? "scan.from.sample" : paper.source === "ai" ? "scan.from.ai" : "scan.from.typed");
  return (
    <li className={styles.paper} data-testid="paper">
      <div className={styles.paperHead}>
        <span className={styles.paperN}>
          {label}: {t(`scan.kind.${paper.kind}` as Key)}
        </span>
        <button type="button" className={styles.remove} onClick={onRemove} aria-label={t("file.remove", { name: label })}>
          <IconX weight="bold" size={20} />
          <span>{t("common.remove")}</span>
        </button>
      </div>
      {problem ? (
        <p className={styles.problem} role="alert">
          {t(problem)}
        </p>
      ) : null}
      {open ? (
        <>
          <Select label={t("scan.kind")} value={paper.kind} onChange={(kind) => onEdit({ kind: kind as IdentityReading["kind"] })} options={PAPER_KINDS.map((k) => ({ value: k, label: t(`scan.kind.${k}` as Key) }))} />
          <TextInput label={t("scan.name")} hint={t("scan.name.help")} value={paper.full_name ?? ""} onChange={(name) => onEdit({ full_name: name.trim() ? (cleanName(name) ?? name.slice(0, 80)) : null })} ltr mic={false} autoComplete="off" />
          <TextInput label={t("scan.expiry")} hint={t("scan.expiry.help")} type="date" value={paper.expiry_date ?? ""} onChange={(value) => onEdit({ expiry_date: isoDate(value) })} ltr mic={false} optional />
          <Button variant="secondary" compact full={false} icon={<IconCheck weight="bold" size={20} />} onClick={() => onOpen(false)} data-testid="paper-done">
            {t("scan.done")}
          </Button>
        </>
      ) : (
        <>
          <p className={styles.summaryName}>
            {paper.full_name ? (
              <bdi className={styles.name} dir="ltr">
                {paper.full_name}
              </bdi>
            ) : (
              <span className="soft">{t("scan.noName")}</span>
            )}
          </p>
          <p>{paper.expiry_date ? t("scan.until", { date: date(paper.expiry_date) }) : t("scan.noExpiry")}</p>
          <p className="small soft">{from}</p>
          <Button variant="secondary" compact full={false} icon={<IconPencilSimpleLine size={20} />} onClick={() => onOpen(true)} data-testid="paper-correct">
            {t("scan.correct")}
          </Button>
        </>
      )}
    </li>
  );
}
