"use client";

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { IconArrowCounterClockwise, IconFileCsv, IconUploadSimple } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { useStore } from "@/lib/data";
import { parseRecruiterCsv } from "@/lib/engine/recruiters";
import { localToday } from "@/lib/engine/readiness";
import { useI18n } from "@/lib/i18n";
import { refreshRecruiterList } from "@/lib/recruiter-list";
import { useRole } from "@/lib/role";
import type { RecruiterRecord } from "@/lib/types";
import styles from "./Admin.module.css";

const MAX_BYTES = 2 * 1024 * 1024;

interface Preview {
  rows: RecruiterRecord[];
  skipped: number;
  fileName: string;
}

/**
 * Admin: import the official licensed recruiter list (CSV) so every agent check uses it. The file
 * is read and checked on this phone; nothing is sent until "Use this list". Admin only; the
 * Firestore rules refuse the write to anyone who is not staff.
 */
export function AdminScreen() {
  const { t, date, machine } = useI18n();
  const { store } = useStore();
  const role = useRole();
  const [current, setCurrent] = useState<{ count: number; loadedOn: string | null } | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [listDate, setListDate] = useState(localToday());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const admin = role.ready && role.role === "admin";

  const load = useCallback(async () => {
    if (!store) return;
    setFailed(false);
    try {
      const list = await store.getRecruiterList();
      setCurrent(list ? { count: list.rows.length, loadedOn: list.loaded_on } : null);
    } catch {
      setFailed(true);
    }
  }, [store]);
  useEffect(() => {
    if (admin) void load();
  }, [admin, load]);

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    setDone(null);
    setPreview(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setProblem(t("admin.tooLarge"));
    try {
      const text = await file.text();
      const rows = parseRecruiterCsv(text, "official_list");
      const lines = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
      if (!rows.length) throw new Error("no rows with a licence number, a name and a known status");
      setProblem(null);
      setPreview({ rows, skipped: Math.max(0, lines - rows.length), fileName: file.name });
    } catch (error) {
      setProblem(t("admin.bad", { reason: (error as Error).message }));
    }
  };

  const use = async () => {
    if (!store || !preview) return;
    setBusy(true);
    try {
      await store.saveRecruiterList(preview.rows, listDate || localToday());
      refreshRecruiterList();
      setDone(t("admin.imported", { n: preview.rows.length }));
      setPreview(null);
      await load();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!store) return;
    setBusy(true);
    try {
      await store.clearRecruiterList();
      refreshRecruiterList();
      setDone(t("admin.reset.done"));
      await load();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const count = (status: RecruiterRecord["status"]) => preview?.rows.filter((r) => r.status === status).length ?? 0;

  return (
    <Screen tab="more" back={{ href: "/more", label: t("more.title") }} wide>
      <div className={styles.page} lang={machine ? "en" : undefined}>
        <PageHead title={t("admin.title")} lead={t("admin.lead")} />
        {!role.ready ? <Skeleton lines={3} label={t("common.loading")} /> : null}
        {role.ready && !admin ? (
          <Notice kind="info">
            <p>{t("admin.notAdmin")}</p>
          </Notice>
        ) : null}
        {admin && role.demo ? (
          <Notice kind="info">
            <p>{t("ngo.demo")}</p>
          </Notice>
        ) : null}
        {admin && failed ? <ErrorNotice kind="load" onRetry={() => void load()} /> : null}

        {admin ? (
          <Section title={t("admin.import")} id="admin-import">
            {current === undefined ? (
              <Skeleton lines={1} label={t("common.loading")} />
            ) : (
              <p className={styles.now} data-testid="admin-now">
                {current ? t("admin.now.official", { n: current.count, date: date(current.loadedOn) }) : t("admin.now.sample")}
              </p>
            )}
            <p className={styles.note}>{t("admin.importHelp")}</p>
            <input ref={input} type="file" accept=".csv,text/csv" className="visually-hidden" onChange={(e) => void pick(e)} data-testid="admin-file" aria-label={t("admin.file")} />
            <div className={styles.row}>
              <Button variant="secondary" full={false} icon={<IconFileCsv size={22} />} onClick={() => input.current?.click()}>
                {t("admin.file")}
              </Button>
              {current ? (
                <Button variant="quiet" full={false} icon={<IconArrowCounterClockwise size={22} />} busy={busy && !preview} onClick={() => void reset()} data-testid="admin-reset">
                  {t("admin.reset")}
                </Button>
              ) : null}
            </div>
            {problem ? (
              <p className={styles.problem} role="alert">
                {problem}
              </p>
            ) : null}
            {preview ? (
              <div className={styles.preview} data-testid="admin-preview">
                <p>
                  <strong>{preview.fileName}</strong>
                </p>
                <p>{t("admin.preview", { n: preview.rows.length, skipped: preview.skipped })}</p>
                <p className={styles.note}>{t("admin.statusCount", { a: count("active"), s: count("suspended"), c: count("cancelled") })}</p>
                <ul className={styles.sample} lang="en">
                  {preview.rows.slice(0, 5).map((r) => (
                    <li key={r.license_no}>
                      <code>{r.license_no}</code> {r.name} ({r.status}
                      {r.city ? `, ${r.city}` : ""})
                    </li>
                  ))}
                </ul>
                <TextInput label={t("admin.date")} type="date" value={listDate} onChange={setListDate} ltr mic={false} />
                <Button full={false} icon={<IconUploadSimple size={22} />} busy={busy} onClick={() => void use()} data-testid="admin-use">
                  {t("admin.importBtn")}
                </Button>
              </div>
            ) : null}
            {done ? (
              <Notice kind="success">
                <p>{done}</p>
              </Notice>
            ) : null}
          </Section>
        ) : null}
      </div>
    </Screen>
  );
}
