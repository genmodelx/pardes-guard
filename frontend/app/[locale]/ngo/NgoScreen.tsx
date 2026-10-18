"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconCheck, IconFlask, IconMegaphone, IconProhibit, IconTrash, IconX } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chips";
import { TextArea, TextInput } from "@/components/ui/Field";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { SeverityChip } from "@/components/ui/Verdict";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/data";
import { Graph, type Signal } from "@/lib/engine/network";
import { maskNumbersInText } from "@/lib/engine/text";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { addNgoSamples } from "@/lib/ngo-sample";
import { useDirectory } from "@/lib/use-directory";
import { isStaff, useRole } from "@/lib/role";
import type { PublishedRisk, StoredReport } from "@/lib/store";
import styles from "./Ngo.module.css";

interface Loaded {
  signals: Signal[];
  reports: StoredReport[];
  risks: PublishedRisk[];
  fake: string[];
}

/**
 * The NGO console: reports waiting for review, agents linked across cases, the warnings every
 * worker's check reads, and confirmed fake layouts. Staff only; firestore.rules enforces it.
 * Staff screens stay in English in the machine-drafted languages, so they are marked lang="en" there.
 */
export function NgoScreen() {
  const { t, date, machine } = useI18n();
  const auth = useAuth();
  const { store } = useStore();
  const role = useRole();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { directory } = useDirectory();
  const staff = role.ready && isStaff(role.role);

  const load = useCallback(async () => {
    if (!store) return;
    setFailed(false);
    try {
      const [signals, reports, risks, fake] = await Promise.all([store.listSignals(), store.listReports(), store.listRisks(), store.getFakeLayouts()]);
      setData({ signals, reports, risks, fake });
    } catch {
      setFailed(true);
    }
  }, [store]);

  useEffect(() => {
    if (staff) void load();
  }, [staff, load]);

  const graph = useMemo(() => (data ? new Graph(data.signals, new Set(data.fake)) : null), [data]);

  /** "FIC1006FSD" becomes the firm's name from the list, with the licence after it. */
  const agentName = (label: string) => {
    const match = /^[A-Z0-9]+$/.test(label) ? directory?.check(null, label).match : null;
    return match ? `${match.name} (${label})` : label;
  };

  const act = async (id: string, work: () => Promise<void>) => {
    setBusy(id);
    try {
      await work();
      await load();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const exitDemo = () => auth.setDemoRole("worker");

  return (
    <Screen tab="more" back={{ href: "/more", label: t("more.title") }} wide>
      <div className={styles.page} lang={machine ? "en" : undefined}>
        <PageHead title={t("ngo.title")} lead={t("ngo.lead")} />

        {!role.ready ? <Skeleton lines={4} label={t("common.loading")} /> : null}
        {role.ready && !staff ? (
          <Notice kind="info">
            <p>{t("ngo.notStaff")}</p>
          </Notice>
        ) : null}

        {staff && role.demo ? (
          <Notice kind="info">
            <p>{t("ngo.demo")}</p>
            <div className={styles.row}>
              {data && !data.signals.length && !data.reports.length ? (
                <Button compact full={false} icon={<IconFlask size={20} />} busy={busy === "sample"} onClick={() => store && void act("sample", () => addNgoSamples(store))} data-testid="ngo-sample">
                  {t("ngo.demo.add")}
                </Button>
              ) : null}
              <Button variant="quiet" compact full={false} onClick={exitDemo}>
                {t("ngo.demo.stop")}
              </Button>
            </div>
          </Notice>
        ) : null}

        {staff && failed ? <ErrorNotice kind="load" onRetry={() => void load()} /> : null}
        {staff && !data && !failed ? <Skeleton lines={6} label={t("common.loading")} /> : null}

        {staff && data && graph ? (
          <>
            <Reports reports={data.reports} busy={busy} onReview={(id, status, note) => act(id, () => store!.reviewReport(id, status, note))} />

            <Section title={t("ngo.rings")} id="ngo-rings">
              <p className={styles.note}>{t("ngo.ringsHelp")}</p>
              {graph.rings().length ? (
                <ul className={styles.list} data-testid="ngo-rings">
                  {graph.rings().map((ring) => (
                    <li key={ring.id} className={styles.item}>
                      <ul className={styles.names}>
                        {ring.recruiters.map((r) => (
                          <li key={r}>{agentName(r)}</li>
                        ))}
                      </ul>
                      <p className={styles.meta}>{t("ngo.ringLine", { p: ring.shared_phones, a: ring.shared_accounts, c: ring.cases, r: Math.round(ring.risk * 100) })}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.note}>{t("ngo.ringsEmpty")}</p>
              )}
            </Section>

            <Section title={t("ngo.alerts")} id="ngo-alerts">
              {graph.alerts().length ? (
                <ul className={styles.list} data-testid="ngo-alerts">
                  {graph.alerts().map((a, i) => (
                    <li key={`${a.pattern}-${i}`} className={styles.item}>
                      <SeverityChip severity={a.severity} />
                      <p>{t(`ngo.alert.${a.pattern}` as Key, { n: a.entities.length, c: a.cases ?? 0 })}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.note}>{t("ngo.alertsEmpty")}</p>
              )}
            </Section>

            <Warnings graph={graph} published={data.risks} agentName={agentName} busy={busy} onPublish={(key, label, entry) => act(key, () => store!.publishRisk(key, label, entry))} onWithdraw={(key) => act(key, () => store!.withdrawRisk(key))} date={date} />

            <Layouts signals={data.signals} confirmed={data.fake} busy={busy} onSave={(hashes) => act("layouts", () => store!.setFakeLayouts(hashes))} />
          </>
        ) : null}
      </div>
    </Screen>
  );
}

function Reports({ reports, busy, onReview }: { reports: StoredReport[]; busy: string | null; onReview: (id: string, status: "reviewed" | "dismissed", note: string | null) => Promise<void> }) {
  const { t, date } = useI18n();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const pending = reports.filter((r) => r.status === "pending");
  const done = reports.length - pending.length;
  return (
    <Section title={t("ngo.queue")} id="ngo-queue">
      {pending.length ? (
        <ul className={styles.list} data-testid="ngo-reports">
          {pending.map((r) => (
            <li key={r.id} className={styles.item} data-testid="ngo-report">
              <div className={styles.row}>
                <Chip tone={r.kind === "content_error" ? "neutral" : "amber"}>{t(`ngo.report.kind.${r.kind}` as Key)}</Chip>
                <span className={styles.meta}>{date(r.created_at)}</span>
              </div>
              {r.recruiter_name || r.recruiter_license ? <p className={styles.agent}>{t("ngo.report.agent", { name: [r.recruiter_name, r.recruiter_license].filter(Boolean).join(", ") })}</p> : null}
              <p className={styles.text} dir="auto">
                {maskNumbersInText(r.text)}
              </p>
              <div className={styles.field}>
                <TextArea label={t("ngo.note")} value={notes[r.id] ?? ""} onChange={(v) => setNotes((n) => ({ ...n, [r.id]: v }))} rows={2} maxLength={500} mic={false} />
              </div>
              <div className={styles.row}>
                <Button compact full={false} icon={<IconCheck size={20} />} busy={busy === r.id} onClick={() => void onReview(r.id, "reviewed", notes[r.id] ?? null)} data-testid="ngo-reviewed">
                  {t("ngo.markReviewed")}
                </Button>
                <Button variant="quiet" compact full={false} icon={<IconX weight="bold" size={20} />} disabled={busy === r.id} onClick={() => void onReview(r.id, "dismissed", notes[r.id] ?? null)}>
                  {t("ngo.dismiss")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.note}>{t("ngo.queueEmpty")}</p>
      )}
      {done ? <p className={styles.meta}>{t("ngo.reviewed", { n: done })}</p> : null}
    </Section>
  );
}

function Warnings({
  graph,
  published,
  agentName,
  busy,
  onPublish,
  onWithdraw,
  date,
}: {
  graph: Graph;
  published: PublishedRisk[];
  agentName: (label: string) => string;
  busy: string | null;
  onPublish: (key: string, label: string, entry: { risk: number; reasons: string[] }) => Promise<void>;
  onWithdraw: (key: string) => Promise<void>;
  date: (iso: string | null | undefined) => string;
}) {
  const { t } = useI18n();
  const byKey = new Map(published.map((p) => [p.key, p]));
  const rows = graph
    .recruiterKeys()
    .map((key) => ({ key, label: graph.label(key), ...graph.risk(key) }))
    .filter((r) => r.risk > 0 || byKey.has(r.key))
    .sort((a, b) => b.risk - a.risk);
  return (
    <Section title={t("ngo.warnings")} id="ngo-warnings">
      <p className={styles.note}>{t("ngo.warningsHelp")}</p>
      {rows.length ? (
        <ul className={styles.list} data-testid="ngo-warnings">
          {rows.map((r) => {
            const live = byKey.get(r.key);
            return (
              <li key={r.key} className={styles.item} data-testid="ngo-warning">
                <p className={styles.agent}>{agentName(r.label)}</p>
                <p className={styles.meta}>{t("ngo.risk", { r: Math.round(r.risk * 100) })}</p>
                <ul className={styles.reasons} lang="en">
                  {r.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                {live ? (
                  <div className={styles.row}>
                    <Chip tone="red" icon={<IconMegaphone size={18} />}>
                      {t("ngo.published", { date: date(live.published_at) })}
                    </Chip>
                    <Button variant="quiet" compact full={false} icon={<IconProhibit size={20} />} busy={busy === r.key} onClick={() => void onWithdraw(r.key)}>
                      {t("ngo.withdraw")}
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" compact full={false} icon={<IconMegaphone size={20} />} busy={busy === r.key} onClick={() => void onPublish(r.key, r.label, { risk: r.risk, reasons: r.reasons })} data-testid="ngo-publish">
                    {t("ngo.publish")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.note}>{t("ngo.warningsEmpty")}</p>
      )}
    </Section>
  );
}

function Layouts({ signals, confirmed, busy, onSave }: { signals: Signal[]; confirmed: string[]; busy: string | null; onSave: (hashes: string[]) => Promise<void> }) {
  const { t } = useI18n();
  const [typed, setTyped] = useState("");
  const [bad, setBad] = useState(false);
  const seen = new Map<string, Set<string>>();
  for (const s of signals) for (const l of s.layouts ?? []) seen.set(l, (seen.get(l) ?? new Set()).add(s.case_id));
  const repeated = [...seen.entries()].filter(([hash, cases]) => cases.size >= 2 && !confirmed.includes(hash));
  const add = () => {
    const hash = typed.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return setBad(true);
    setBad(false);
    setTyped("");
    void onSave([...confirmed, hash]);
  };
  const short = (hash: string) => `${hash.slice(0, 16)}…`;
  return (
    <Section title={t("ngo.layouts")} id="ngo-layouts">
      <p className={styles.note}>{t("ngo.layoutsHelp")}</p>
      {repeated.length || confirmed.length ? (
        <ul className={styles.list} data-testid="ngo-layouts">
          {repeated.map(([hash, cases]) => (
            <li key={hash} className={styles.item}>
              <code className={styles.code}>{short(hash)}</code>
              <p className={styles.meta}>{t("ngo.layoutSeen", { c: cases.size })}</p>
              <Button variant="secondary" compact full={false} busy={busy === "layouts"} onClick={() => void onSave([...confirmed, hash])} data-testid="ngo-confirm-layout">
                {t("ngo.confirm")}
              </Button>
            </li>
          ))}
          {confirmed.map((hash) => (
            <li key={hash} className={styles.item}>
              <code className={styles.code}>{short(hash)}</code>
              <Chip tone="red">{t("ngo.confirmed")}</Chip>
              <Button variant="quiet" compact full={false} icon={<IconTrash size={20} />} disabled={busy === "layouts"} onClick={() => void onSave(confirmed.filter((h) => h !== hash))}>
                {t("ngo.remove")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.paste}>
        <TextInput label={t("ngo.layoutPaste")} value={typed} onChange={setTyped} ltr mic={false} optional error={bad ? t("ngo.layoutBad") : null} />
        <Button variant="secondary" compact full={false} onClick={add} disabled={!typed.trim()}>
          {t("ngo.add")}
        </Button>
      </div>
    </Section>
  );
}
