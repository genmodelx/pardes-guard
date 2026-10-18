"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconCopy, IconEnvelopeSimple, IconPaperclip, IconRobot, IconShareNetwork, IconSiren, IconUsersThree, IconVault, IconWhatsappLogo } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { CaseStatusChip, EmergencyChip, Ladder, useStepName } from "@/components/ui/CaseParts";
import { CodeBox } from "@/components/ui/CodeBox";
import { Select, TextArea } from "@/components/ui/Field";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { ConfirmDialog } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { aiProvider } from "@/lib/ai-firebase";
import { draftLetter, shareLinks } from "@/lib/case-letter";
import { cx } from "@/lib/cx";
import { useJourney, useStore } from "@/lib/data";
import { useAuth } from "@/lib/auth";
import { approveStep, attachEvidence, declineStep, markSent, newShareCode, resolveCase, updateDraft } from "@/lib/engine/cases";
import { familyView, syncShare } from "@/lib/family";
import { languageInfo, useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { useLabels } from "@/lib/labels";
import { PROMPTS } from "@/lib/prompts";
import { useQueryParam } from "@/lib/query";
import type { Case, CaseEvent, EvidenceRecord, LadderStep } from "@/lib/types";
import styles from "../Cases.module.css";

const CHANNELS = ["whatsapp", "email", "hand", "post", "other"] as const;
const LETTER_LANGUAGES = ["en", "ur", "ar"];

/** One case: what to do now, the ladder, what happened, and its history. */
export function CaseScreen() {
  const { t } = useI18n();
  const id = useQueryParam("id");
  const { store } = useStore();
  const [c, setCase] = useState<Case | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    setFailed(false);
    (id ? store.getCase(id) : Promise.resolve(null))
      .then((found) => !cancelled && setCase(found))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [store, id, attempt]);

  return (
    <Screen tab="help" back={{ href: "/cases", label: t("cases.title") }}>
      {failed ? <ErrorNotice kind="load" onRetry={() => setAttempt((n) => n + 1)} /> : null}
      {c === undefined && !failed ? <Skeleton lines={6} label={t("common.loading")} /> : null}
      {c === null ? (
        <Notice kind="info" action={t("cases.title")} actionHref="/cases">
          <p>{t("case.notFound")}</p>
        </Notice>
      ) : null}
      {c ? <CaseView c={c} onChange={setCase} /> : null}
    </Screen>
  );
}

function CaseView({ c, onChange }: { c: Case; onChange: (c: Case) => void }) {
  const { t, date } = useI18n();
  const labels = useLabels();
  const { store } = useStore();
  const journey = useJourney();
  const stepName = useStepName();
  const [saveFailed, setSaveFailed] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");

  /** Change a copy of the case with one of the engine's functions, save it, then show it. */
  const update = async (change: (draft: Case) => void): Promise<boolean> => {
    if (!store) return false;
    const next = structuredClone(c);
    try {
      change(next);
      await store.saveCase(next);
    } catch {
      setSaveFailed(true);
      return false;
    }
    await syncShare(store, next);
    setSaveFailed(false);
    onChange(next);
    await journey.refreshCases();
    return true;
  };

  const uid = store?.uid ?? "";
  const waiting = c.ladder.filter((s) => s.status === "awaiting_approval");
  const toSend = c.ladder.filter((s) => s.status === "approved");
  const nextPlanned = c.ladder.find((s) => s.status === "scheduled");
  const closed = c.status === "resolved" || c.status === "closed";
  const country = labels.country(c.destination_country) ?? labels.country(c.origin_country) ?? "";

  return (
    <>
      <PageHead title={c.title}>
        <div className={styles.head}>
          <div className={styles.chips}>
            {c.kind === "emergency" ? <EmergencyChip /> : null}
            <CaseStatusChip status={c.status} />
          </div>
          <p className="small soft">
            {t(`case.kind.${c.kind}` as Key)}. {t("case.opened", { date: date(c.created_at) })}
          </p>
        </div>
      </PageHead>

      {c.kind === "emergency" && !closed ? <EmergencyPanel c={c} country={country} /> : null}

      <Section title={t("case.next")} id="case-next">
        {toSend.map((step) => (
          <SendPanel key={step.index} c={c} step={step} onSent={(channel) => update((d) => markSent(d, step.index, uid, channel))} />
        ))}
        {waiting.map((step) => (
          <LetterEditor
            key={step.index}
            c={c}
            step={step}
            onSave={(text) => update((d) => updateDraft(d, step.index, uid, text))}
            onApprove={(text) =>
              update((d) => {
                if (text !== step.draft) updateDraft(d, step.index, uid, text);
                approveStep(d, step.index, uid);
              })
            }
            onDecline={() => update((d) => declineStep(d, step.index, uid))}
          />
        ))}
        {!waiting.length && !toSend.length ? (
          <p>{closed ? t("case.resolved") : nextPlanned ? t("case.waitingNext", { date: date(nextPlanned.due_at) }) : t("case.allDone")}</p>
        ) : null}
        {saveFailed ? <ErrorNotice kind="save" /> : null}
      </Section>

      <Section title={t("case.ladder")} id="case-ladder">
        <Ladder c={c} />
      </Section>

      <Section title={t("case.summary")} id="case-summary">
        <p className={styles.summary} dir="auto">
          {c.summary}
        </p>
      </Section>

      <EvidenceSection c={c} onAttach={(id) => update((d) => attachEvidence(d, id))} />

      <FamilySection c={c} onChange={onChange} />

      <Section title={t("case.history")} id="case-history">
        <ul className={styles.history}>
          {[...c.events].reverse().map((e, i) => (
            <li key={`${e.at}-${i}`}>
              <EventLine e={e} c={c} stepName={stepName} />
              <span className="small soft">{date(e.at, true)}</span>
            </li>
          ))}
        </ul>
      </Section>

      {!closed ? (
        <Button variant="secondary" full icon={<IconCheck weight="bold" size={22} />} onClick={() => setResolving(true)} data-testid="resolve">
          {t("case.resolve")}
        </Button>
      ) : null}

      <ConfirmDialog
        open={resolving}
        title={t("case.resolve.title")}
        body={
          <>
            <p>{t("case.resolve.lead")}</p>
            <TextArea label={t("case.resolve.note")} value={note} onChange={setNote} rows={3} optional maxLength={500} />
          </>
        }
        confirmLabel={t("case.resolve")}
        onConfirm={() => {
          setResolving(false);
          void update((d) => resolveCase(d, uid, note));
        }}
        onCancel={() => setResolving(false)}
      />
    </>
  );
}

/** A code that lets family follow the case's progress, and only its progress. */
function FamilySection({ c, onChange }: { c: Case; onChange: (c: Case) => void }) {
  const { t, href } = useI18n();
  const { store } = useStore();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stopped, setStopped] = useState(false);
  const code = c.family_share_code ?? null;

  const share = async () => {
    if (!store) return;
    setBusy(true);
    setFailed(false);
    setStopped(false);
    const next = structuredClone(c);
    next.family_share_code = newShareCode();
    try {
      // The case is saved first: the rules let only the owner of a saved case share it.
      await store.saveCase(next);
      await store.saveShare(next.family_share_code, next.id, familyView(next));
      onChange(next);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  const stop = async () => {
    if (!store || !code) return;
    setBusy(true);
    const next = structuredClone(c);
    next.family_share_code = null;
    try {
      await store.deleteShare(code);
      await store.saveCase(next);
      onChange(next);
      setStopped(true);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  const link = typeof window === "undefined" ? "" : `${window.location.origin}${href("/family")}`;
  const message = code ? t("case.share.message", { link: `${link}?code=${code}`, code }) : "";

  return (
    <Section title={t("case.family")} id="case-family">
      <p>{t("case.shareHelp")}</p>
      {store?.kind === "local" ? <p className={styles.note}>{t("case.share.local")}</p> : null}
      {code ? (
        <>
          <CodeBox label={t("case.share.code")} code={code} />
          <Button variant="secondary" full href={`https://wa.me/?text=${encodeURIComponent(message)}`} external icon={<IconWhatsappLogo size={22} />} data-testid="share-family">
            {t("case.share.send")}
          </Button>
          <Button variant="quiet" full={false} onClick={() => void stop()} busy={busy} data-testid="stop-sharing">
            {t("case.share.stop")}
          </Button>
        </>
      ) : (
        <Button variant="secondary" full icon={<IconShareNetwork size={22} />} onClick={() => void share()} busy={busy} disabled={!store} data-testid="share">
          {t("case.share")}
        </Button>
      )}
      {stopped ? (
        <p className={styles.note} role="status">
          {t("case.share.stopped")}
        </p>
      ) : null}
      {failed ? <ErrorNotice kind="save" /> : null}
      {auth.canSignIn && store?.kind === "local" ? (
        <Button variant="quiet" full={false} href="/signin" icon={<IconUsersThree size={22} />}>
          {t("common.signin")}
        </Button>
      ) : null}
    </Section>
  );
}

/** The vault's files attached to this case, and a way to attach more. */
function EvidenceSection({ c, onAttach }: { c: Case; onAttach: (evidenceId: string) => Promise<boolean> }) {
  const { t, date } = useI18n();
  const { store } = useStore();
  const [records, setRecords] = useState<EvidenceRecord[] | null>(null);
  const [pick, setPick] = useState("");
  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    store
      .listEvidence()
      .then((list) => !cancelled && setRecords(list))
      .catch(() => !cancelled && setRecords([]));
    return () => {
      cancelled = true;
    };
  }, [store, c.evidence_ids.length]);
  const attached = (records ?? []).filter((r) => c.evidence_ids.includes(r.id));
  const others = (records ?? []).filter((r) => !c.evidence_ids.includes(r.id));
  const label = (r: EvidenceRecord) => `${t("vault.no", { n: r.index + 1 })}: ${r.filename} (${date(r.created_at)})`;
  return (
    <Section title={t("case.evidence")} id="case-evidence">
      {attached.length ? (
        <ul className={styles.evidence}>
          {attached.map((r) => (
            <li key={r.id}>
              <IconPaperclip size={20} />
              <bdi dir="ltr">{label(r)}</bdi>
            </li>
          ))}
        </ul>
      ) : (
        <p className="soft">{t("case.noEvidence")}</p>
      )}
      {others.length ? (
        <div className={styles.actions}>
          <Select label={t("case.evidence.pick")} value={pick} onChange={setPick} options={others.map((r) => ({ value: r.id, label: label(r) }))} placeholder="" />
          <Button
            variant="secondary"
            full
            disabled={!pick}
            onClick={async () => {
              if (pick && (await onAttach(pick))) setPick("");
            }}
            data-testid="attach-evidence"
          >
            {t("case.evidence.attach")}
          </Button>
        </div>
      ) : records && !records.length ? (
        <p className="small soft">{t("case.evidence.empty")}</p>
      ) : null}
      <Button variant="quiet" full={false} href={`/vault?case=${encodeURIComponent(c.id)}`} icon={<IconVault size={22} />}>
        {t("case.evidence.open")}
      </Button>
    </Section>
  );
}

function EventLine({ e, c, stepName }: { e: CaseEvent; c: Case; stepName: (s: LadderStep) => string }) {
  const { t, has } = useI18n();
  const key = `event.${e.kind}`;
  if (!has(key)) return <span lang="en">{e.detail}</span>;
  const step = typeof e.step === "number" ? c.ladder[e.step] : undefined;
  const text = t(key as Key, { step: step ? stepName(step) : "" });
  const channel = e.channel ? (has(`case.channel.${e.channel}`) ? t(`case.channel.${e.channel}` as Key) : e.channel) : null;
  return (
    <span>
      {text}
      {channel ? ` (${channel})` : ""}
    </span>
  );
}

/** The letter waiting for approval: read, change, rewrite with AI, then approve or skip. */
function LetterEditor({ c, step, onSave, onApprove, onDecline }: { c: Case; step: LadderStep; onSave: (text: string) => Promise<boolean>; onApprove: (text: string) => Promise<boolean>; onDecline: () => Promise<boolean> }) {
  const { t, locale } = useI18n();
  const ai = aiProvider();
  const stepName = useStepName();
  const [text, setText] = useState(step.draft ?? "");
  const [language, setLanguage] = useState<string>(LETTER_LANGUAGES.includes(locale) ? locale : "en");
  const [writing, setWriting] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const [saved, setSaved] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setText(step.draft ?? ""), [step.draft]);
  const dirty = text !== (step.draft ?? "");

  const write = async () => {
    setWriting("busy");
    const out = await draftLetter(c, step, language, { ai, prompts: PROMPTS });
    if (out.ok) {
      setText(out.text);
      setWriting("done");
    } else setWriting("failed");
  };

  const languages = [...new Set([...LETTER_LANGUAGES, locale])].map((code) => ({ value: code, label: languageInfo(code).native }));

  return (
    <div className={styles.letter} data-testid="letter">
      <h3 className={styles.letterTitle}>{stepName(step)}</h3>
      <p>{t("case.letter.help")}</p>
      {ai.enabled ? (
        <div className={styles.actions}>
          <Select label={t("case.letter.lang")} value={language} onChange={setLanguage} options={languages} />
          <Button variant="secondary" full icon={<IconRobot size={22} />} onClick={() => void write()} busy={writing === "busy"} data-testid="ai-letter">
            {writing === "busy" ? t("case.letter.aiWorking") : t("case.letter.ai")}
          </Button>
          {writing === "done" ? <p className={styles.note}>{t("case.letter.aiDone")}</p> : null}
          {writing === "failed" ? <p className={styles.problem}>{t("case.letter.aiFailed")}</p> : null}
        </div>
      ) : (
        <p className={styles.note}>{t("case.letter.plain")}</p>
      )}
      <TextArea
        label={t("case.letter.label")}
        value={text}
        onChange={(v) => {
          setText(v);
          setSaved(false);
        }}
        rows={14}
        mic={false}
        dir="auto"
        className={styles.letterText}
        maxLength={4000}
      />
      <div className={styles.actions}>
        <Button
          onClick={async () => {
            setBusy(true);
            await onApprove(text);
            setBusy(false);
          }}
          busy={busy}
          icon={<IconCheck weight="bold" size={22} />}
          data-testid="approve"
        >
          {t("case.approve")}
        </Button>
        <div className={styles.row2}>
          {dirty ? (
            <Button variant="secondary" full={false} onClick={async () => setSaved(await onSave(text))} data-testid="save-letter">
              {t("case.saveDraft")}
            </Button>
          ) : null}
          <Button variant="quiet" full={false} onClick={() => setDeclining(true)} data-testid="decline">
            {t("case.decline")}
          </Button>
        </div>
        {saved ? (
          <p className={styles.note} role="status">
            {t("case.saved")}
          </p>
        ) : null}
      </div>
      <ConfirmDialog
        open={declining}
        title={t("case.decline.title")}
        body={<p>{t("case.decline.lead")}</p>}
        confirmLabel={t("case.decline")}
        onConfirm={() => {
          setDeclining(false);
          void onDecline();
        }}
        onCancel={() => setDeclining(false)}
      />
    </div>
  );
}

/** An approved letter: the person sends it from their own apps, then says how. */
function SendPanel({ c, step, onSent }: { c: Case; step: LadderStep; onSent: (channel: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const stepName = useStepName();
  const [channel, setChannel] = useState<string>("whatsapp");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const letter = step.draft ?? "";
  const links = shareLinks(letter, `${stepName(step)}: ${c.title}`);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(letter);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={cx(styles.letter, styles.approved)} data-testid="send">
      <h3 className={styles.letterTitle}>{t("case.send.title")}</h3>
      <p>{stepName(step)}</p>
      <p>{t("case.send.lead")}</p>
      <pre className={styles.letterPreview} dir="auto">
        {letter}
      </pre>
      <div className={styles.actions}>
        <Button variant="secondary" full href={links.whatsapp} external icon={<IconWhatsappLogo size={22} />} data-testid="share-whatsapp">
          {t("case.send.whatsapp")}
        </Button>
        <Button variant="secondary" full href={links.email} external icon={<IconEnvelopeSimple size={22} />} data-testid="share-email">
          {t("case.send.email")}
        </Button>
        <Button variant="secondary" full onClick={() => void copy()} icon={<IconCopy size={22} />} data-testid="copy-letter">
          {t("case.send.copy")}
        </Button>
        {copied ? (
          <p className={styles.note} role="status">
            {t("case.send.copied")}
          </p>
        ) : null}
        <Select label={t("case.sent.how")} value={channel} onChange={setChannel} options={CHANNELS.map((ch) => ({ value: ch, label: t(`case.channel.${ch}` as Key) }))} />
        <Button
          onClick={async () => {
            setBusy(true);
            await onSent(channel);
            setBusy(false);
          }}
          busy={busy}
          icon={<IconCheck weight="bold" size={22} />}
          data-testid="mark-sent"
        >
          {t("case.sent")}
        </Button>
      </div>
    </div>
  );
}

/** An emergency case: a message the person sends to family themselves, and the help contacts. */
function EmergencyPanel({ c, country }: { c: Case; country: string }) {
  const { t } = useI18n();
  const message = t("case.emergency.message", { country: country || "-", title: c.title });
  return (
    <Panel title={t("case.emergency.title")} tone="danger">
      <p>{t("case.emergency.lead")}</p>
      <Button variant="secondary" full href={`https://wa.me/?text=${encodeURIComponent(message)}`} external icon={<IconWhatsappLogo size={22} />} data-testid="emergency-whatsapp">
        {t("case.emergency.share")}
      </Button>
      <Button variant="secondary" full href="/sos" icon={<IconSiren weight="fill" size={22} />}>
        {t("case.emergency.sos")}
      </Button>
    </Panel>
  );
}
