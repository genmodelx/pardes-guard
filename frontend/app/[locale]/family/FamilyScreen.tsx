"use client";

import { useEffect, useState, type FormEvent } from "react";
import { IconCheckCircle, IconCircle, IconEnvelopeSimple, IconMinusCircle, IconPaperPlaneTilt, IconXCircle } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { CaseStatusChip, EmergencyChip } from "@/components/ui/CaseParts";
import { TextInput } from "@/components/ui/Field";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { useStore } from "@/lib/data";
import { STEP_NAMES, cleanShareCode } from "@/lib/engine/cases";
import { readShare } from "@/lib/family";
import { firebaseEnabled } from "@/lib/firebase";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { useLabels } from "@/lib/labels";
import { useQueryParam } from "@/lib/query";
import type { StoredShare } from "@/lib/store";
import type { StepAction, StepStatus } from "@/lib/types";
import styles from "./Family.module.css";

const STEP_ICON: Record<StepStatus, typeof IconCircle> = {
  scheduled: IconCircle,
  awaiting_approval: IconEnvelopeSimple,
  approved: IconCheckCircle,
  sent: IconPaperPlaneTilt,
  declined: IconXCircle,
  skipped: IconMinusCircle,
};

/** The shared view keeps each step's English name; this finds the step it names, to say it in the reader's language. */
const ACTION_BY_NAME = Object.fromEntries(Object.entries(STEP_NAMES).map(([action, name]) => [name, action])) as Record<string, StepAction>;

/** Family view: enter a share code, see the case's progress. */
export function FamilyScreen() {
  const { t, date } = useI18n();
  const labels = useLabels();
  const { store } = useStore();
  const codeParam = useQueryParam("code");
  const [code, setCode] = useState("");
  const [share, setShare] = useState<StoredShare | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = async (typed: string) => {
    setBusy(true);
    setFailed(false);
    try {
      setShare(await readShare(typed, store));
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  // A link with the code in it opens the case at once.
  useEffect(() => {
    if (!codeParam || !store) return;
    setCode(codeParam);
    void open(codeParam);
    // `open` only reads `store`, which is in the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeParam, store]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void open(code);
  };

  const view = share?.view;

  return (
    <Screen tab="help" back={{ href: "/help", label: t("help.title") }}>
      <PageHead title={t("family.title")} lead={t("family.lead")} />
      {!firebaseEnabled ? (
        <Notice kind="info">
          <p>{t("family.local")}</p>
        </Notice>
      ) : null}

      <form className={styles.form} onSubmit={submit}>
        <TextInput label={t("family.code")} hint={t("family.code.help")} value={code} onChange={(v) => setCode(cleanShareCode(v).slice(0, 14))} ltr mic={false} autoComplete="off" name="code" />
        <Button type="submit" variant="secondary" full={false} busy={busy} data-testid="open-share">
          {t("family.open")}
        </Button>
      </form>

      {failed ? <ErrorNotice kind="load" onRetry={() => void open(code)} /> : null}
      {share === null ? (
        <Notice kind="warning">
          <p>{t("family.notFound")}</p>
        </Notice>
      ) : null}

      {view ? (
        <Section title={view.title} id="family-case">
          <div className={styles.chips}>
            {view.kind === "emergency" ? <EmergencyChip /> : null}
            <CaseStatusChip status={view.status} />
          </div>
          <p className="small soft">
            {t(`case.kind.${view.kind}` as Key)}
            {view.destination_country ? `. ${labels.country(view.destination_country) ?? view.destination_country}` : ""}. {t("family.updated", { date: date(view.updated_at) })}
          </p>
          {view.alerts.length ? (
            <Notice kind="error">
              <p>{t("family.emergency")}</p>
            </Notice>
          ) : null}
          <h3>{t("case.ladder")}</h3>
          <ol className={styles.steps}>
            {view.steps.map((step, i) => {
              const Icon = STEP_ICON[step.status];
              const action = step.action ?? ACTION_BY_NAME[step.name];
              return (
                <li key={i} data-status={step.status}>
                  <Icon weight={step.status === "scheduled" ? "regular" : "fill"} size={24} className={styles.icon} />
                  <span>
                    <span className={styles.name} lang={action ? undefined : "en"}>
                      {action ? t(`step.${action}` as Key) : step.name}
                    </span>
                    <span className="small soft">{t(`famstep.${step.status}` as Key)}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="small soft">{t("family.private")}</p>
        </Section>
      ) : null}
    </Screen>
  );
}
