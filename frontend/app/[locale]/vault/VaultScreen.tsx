"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconDownloadSimple, IconFileText, IconSealCheck } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Select, TextInput } from "@/components/ui/Field";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { AddPaperButtons } from "@/components/ui/PaperPicker";
import { Skeleton } from "@/components/ui/Skeleton";
import { useStore } from "@/lib/data";
import { attachEvidence } from "@/lib/engine/cases";
import { formatNumber, useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { useQueryParam } from "@/lib/query";
import type { Case, EvidenceRecord } from "@/lib/types";
import { VaultError, addToVault, checkVault, exportVault, type VaultCheck } from "@/lib/vault";
import { deviceFiles, type FileStore } from "@/lib/vault-files";
import styles from "./Vault.module.css";

/** Evidence can be any kind of file: a payslip photo, a PDF, a voice message, a chat export. */
const ANY_FILE = "*/*";

export function fileSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${formatNumber(Math.round((10 * bytes) / (1024 * 1024)) / 10)} MB` : `${formatNumber(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** Save a file the app made (the ZIP) to the phone, the way a download link does. */
function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** The evidence vault: files with fingerprints chained one to the next, kept on this phone. */
export function VaultScreen() {
  const { t, date } = useI18n();
  const { store } = useStore();
  const caseParam = useQueryParam("case");
  const [files, setFiles] = useState<FileStore | null>(null);
  const [records, setRecords] = useState<EvidenceRecord[] | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [here, setHere] = useState<Map<string, string | null>>(new Map());
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [caseId, setCaseId] = useState("");
  const [saving, setSaving] = useState<{ n: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<"saved" | "tooLarge" | "failed" | null>(null);
  const [check, setCheck] = useState<VaultCheck | "busy" | null>(null);
  const [exporting, setExporting] = useState(false);
  // Pictures of the images on this phone, released when the list changes or the screen closes.
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  useEffect(() => {
    void deviceFiles().then(setFiles);
  }, []);
  useEffect(() => setCaseId(caseParam ?? ""), [caseParam]);

  const load = useCallback(async () => {
    if (!store || !files) return;
    setFailed(false);
    try {
      const [list, mine, local] = await Promise.all([store.listEvidence(), store.listCases().catch(() => [] as Case[]), files.list(store.uid)]);
      setRecords(list);
      setCases(mine.filter((c) => c.status !== "resolved" && c.status !== "closed"));
      urls.current.forEach((url) => URL.revokeObjectURL(url));
      urls.current = [];
      const next = new Map<string, string | null>();
      for (const f of local) {
        const url = f.type.startsWith("image/") ? URL.createObjectURL(f.blob) : null;
        if (url) urls.current.push(url);
        next.set(f.id, url);
      }
      setHere(next);
    } catch {
      setFailed(true);
    }
  }, [store, files]);
  useEffect(() => {
    void load();
  }, [load]);

  const add = async (picked: File[]) => {
    if (!store || !files) return;
    setOutcome(null);
    setCheck(null);
    let problem: "tooLarge" | "failed" | null = null;
    for (let i = 0; i < picked.length; i++) {
      setSaving({ n: i + 1, total: picked.length });
      try {
        const record = await addToVault({ store, files, file: picked[i], name: picked[i].name, note, caseId: caseId || null });
        if (caseId) {
          // Read the case again for each file, so two files in a row are both kept.
          const c = await store.getCase(caseId).catch(() => null);
          if (c) {
            attachEvidence(c, record.id);
            await store.saveCase(c).catch(() => undefined);
          }
        }
      } catch (error) {
        problem = error instanceof VaultError && error.code === "tooLarge" ? "tooLarge" : "failed";
      }
    }
    setSaving(null);
    setOutcome(problem ?? "saved");
    if (!problem) setNote("");
    await load();
  };

  const runCheck = async () => {
    if (!store || !files) return;
    setCheck("busy");
    setCheck(await checkVault(store, files));
  };

  const download = async () => {
    if (!store || !files) return;
    setExporting(true);
    try {
      saveFile(await exportVault(store, files), `pardes-guard-evidence-${new Date().toISOString().slice(0, 10)}.zip`);
    } finally {
      setExporting(false);
    }
  };

  const caseTitle = (id: string | null | undefined) => cases.find((c) => c.id === id)?.title ?? null;

  return (
    <Screen tab="help" back={{ href: "/help", label: t("help.title") }}>
      <PageHead title={t("vault.title")} lead={t("vault.lead")} />

      {files && !files.persistent ? (
        <Notice kind="warning">
          <p>{t("vault.memory")}</p>
        </Notice>
      ) : (
        <Notice kind="info">
          <p>{store?.kind === "firestore" ? t("vault.where.account") : t("vault.where.guest")}</p>
          <p>{t("vault.where.backup")}</p>
        </Notice>
      )}

      <Section title={t("vault.add")} id="vault-add">
        <TextInput label={t("vault.note")} value={note} onChange={setNote} optional maxLength={300} />
        {cases.length ? <Select label={t("vault.case")} value={caseId} onChange={setCaseId} options={cases.map((c) => ({ value: c.id, label: c.title }))} placeholder={t("vault.noCase")} optional /> : null}
        <AddPaperButtons onPick={(picked) => void add(picked)} disabled={!store || !files || saving !== null} accept={ANY_FILE} />
        {saving ? (
          <p className={styles.status} role="status">
            {t("vault.saving", { n: saving.n, total: saving.total })}
          </p>
        ) : null}
        {outcome === "saved" ? (
          <p className={styles.status} role="status">
            {t("vault.savedOne")}
          </p>
        ) : null}
        {outcome === "tooLarge" ? <p className={styles.problem}>{t("vault.tooLarge")}</p> : null}
        {outcome === "failed" ? <ErrorNotice kind="save" /> : null}
      </Section>

      <Section title={t("vault.files")} id="vault-files">
        {failed ? <ErrorNotice kind="load" onRetry={() => void load()} /> : null}
        {!records && !failed ? <Skeleton lines={3} label={t("common.loading")} /> : null}
        {records && !records.length ? (
          <p className="soft" data-testid="vault-empty">
            {t("vault.empty")}
          </p>
        ) : null}
        {records?.length ? (
          <>
            <ol className={styles.list}>
              {[...records].reverse().map((r) => {
                const onPhone = here.has(r.id);
                const picture = here.get(r.id);
                const inCase = caseTitle(r.case_id);
                return (
                  <li key={r.id} className={styles.item} data-testid="evidence">
                    {picture ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className={styles.thumb} src={picture} alt="" />
                    ) : (
                      <span className={styles.thumb}>
                        <IconFileText weight="duotone" size={32} />
                      </span>
                    )}
                    <span className={styles.text}>
                      <span className={styles.name}>
                        <span>{t("vault.no", { n: r.index + 1 })}</span>{" "}
                        <bdi dir="ltr" lang="en">
                          {r.filename}
                        </bdi>
                      </span>
                      <span className="small soft">
                        {date(r.created_at, true)}, <bdi dir="ltr">{fileSize(r.size)}</bdi>
                      </span>
                      {r.note ? (
                        <span className="small" dir="auto">
                          {r.note}
                        </span>
                      ) : null}
                      {inCase ? <span className="small">{t("vault.inCase", { title: inCase })}</span> : null}
                      <span className="small soft">
                        {t("vault.fingerprint")}:{" "}
                        <bdi dir="ltr" className={styles.hash}>
                          {r.sha256.slice(0, 16)}
                        </bdi>
                      </span>
                      {!onPhone ? <span className={styles.problem}>{t("vault.notHere")}</span> : null}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className={styles.actions}>
              <Button variant="secondary" full icon={<IconSealCheck size={22} />} onClick={() => void runCheck()} busy={check === "busy"} data-testid="verify">
                {check === "busy" ? t("vault.checking") : t("vault.verify")}
              </Button>
              {check && check !== "busy" ? (
                check.ok ? (
                  <Notice kind="success">
                    <p>{t("vault.ok", { n: check.records })}</p>
                    {check.files_missing ? <p>{t("vault.okMissing", { n: check.files_missing })}</p> : null}
                  </Notice>
                ) : (
                  <Notice kind="error">
                    <p>{t("vault.bad", { i: (check.first_bad_index ?? 0) + 1, reason: t(`vault.problem.${check.code ?? "details"}` as Key) })}</p>
                  </Notice>
                )
              ) : null}
              <Button variant="secondary" full icon={<IconDownloadSimple size={22} />} onClick={() => void download()} busy={exporting} data-testid="export">
                {t("vault.export")}
              </Button>
              <p className="small soft">{t("vault.exported")}</p>
            </div>
          </>
        ) : null}
      </Section>
    </Screen>
  );
}
