"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconCoins, IconFileText, IconHourglass, IconIdentificationBadge, IconPassport, IconQuestion, IconSiren } from "@/components/icons";
import { PageHead, Screen, Section, StickyActions } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup, ChoiceTile } from "@/components/ui/ChoiceTile";
import { Select, TextArea, TextInput } from "@/components/ui/Field";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { caseDraft, dropCaseDraft } from "@/lib/case-draft";
import { useJourney, useStore } from "@/lib/data";
import { openCase } from "@/lib/engine/cases";
import { useFlagWords } from "@/lib/flag-text";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { useLabels } from "@/lib/labels";
import { PACK_INDEX } from "@/lib/packs";
import { useQueryParam } from "@/lib/query";
import type { StoredCheck } from "@/lib/store";
import { CASE_KINDS, type CaseKind } from "@/lib/types";
import styles from "../Cases.module.css";

const KIND_ICON: Record<CaseKind, typeof IconCoins> = {
  wage_short: IconCoins,
  wage_late: IconHourglass,
  passport_held: IconPassport,
  contract_changed: IconFileText,
  recruiter_fraud: IconIdentificationBadge,
  fraud_ring_link: IconIdentificationBadge,
  emergency: IconSiren,
  other: IconQuestion,
};

/** Open a case: what happened, in the person's words. A check result or the wage check can start it. */
export function NewCaseScreen() {
  const { t, href, date } = useI18n();
  const labels = useLabels();
  const router = useRouter();
  const { store } = useStore();
  const journey = useJourney();
  const words = useFlagWords(journey.origin);
  const checkId = useQueryParam("check");
  const kindParam = useQueryParam("kind");
  const draftId = useQueryParam("draft");

  const [kind, setKind] = useState<CaseKind>(CASE_KINDS.includes(kindParam as CaseKind) ? (kindParam as CaseKind) : "other");
  // null: the case is named after its kind until the person (or a draft) names it.
  const [customTitle, setCustomTitle] = useState<string | null>(null);
  const [summary, setSummary] = useState("");
  const [country, setCountry] = useState("");
  const [check, setCheck] = useState<StoredCheck | null>(null);
  const [problem, setProblem] = useState<"need" | "failed" | null>(null);
  const [busy, setBusy] = useState(false);

  // Start from what another screen handed over, or from the check named in the address. The
  // address can arrive a moment after the first render, so this runs again when it changes.
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${draftId ?? ""}|${checkId ?? ""}`;
    if (startedFor.current === key || !store || journey.status === "loading") return;
    startedFor.current = key;
    const draft = caseDraft(draftId);
    if (draft) {
      setKind(draft.kind);
      setCustomTitle(draft.title);
      setSummary(draft.summary);
      setCountry(draft.destination_country ?? journey.plan?.answers.destination ?? "");
      return;
    }
    setCountry(journey.plan?.answers.destination ?? "");
    if (!checkId) return;
    void store.getCheck(checkId).then((found) => {
      if (!found) return;
      setCheck(found);
      setKind("recruiter_fraud");
      const name = found.recruiter?.match?.name ?? found.recruiter?.query_name ?? found.documents[0]?.employer_name ?? t(`doc.type.${found.documents[0]?.doc_type ?? "other"}` as Key);
      setCustomTitle(t("cnew.checkTitle", { name }));
      const lines = found.flags.filter((f) => f.severity === "high" || f.severity === "medium").map((f) => `- ${words.title(f).text}`);
      setSummary([t("cnew.checkSummary", { date: date(found.created_at) }), ...lines].join("\n"));
      setCountry(found.recruiter?.match ? (journey.plan?.answers.origin ?? "") : (journey.plan?.answers.destination ?? ""));
    });
  }, [store, journey.status, journey.plan, checkId, draftId, t, date, words]);

  const title = customTitle ?? t(`case.kind.${kind}` as Key);

  const create = async () => {
    if (!store) return;
    if (summary.trim().length < 3) return setProblem("need");
    setProblem(null);
    setBusy(true);
    try {
      const ladderDays = journey.origin?.ladder_days?.length ? journey.origin.ladder_days : undefined;
      const { case: c } = openCase(
        store.uid,
        {
          kind,
          title: title.trim() || t(`case.kind.${kind}` as Key),
          summary: summary.trim(),
          origin_country: journey.plan?.answers.origin ?? "PK",
          destination_country: country || null,
          related_check_id: check?.check_id ?? null,
        },
        ladderDays,
      );
      await store.saveCase(c);
      dropCaseDraft(draftId);
      await journey.refreshCases();
      router.push(href(`/cases/view?id=${encodeURIComponent(c.id)}`));
    } catch {
      setBusy(false);
      setProblem("failed");
    }
  };

  const countries = PACK_INDEX.map((p) => ({ value: p.code, label: labels.country(p.code) ?? p.name })).sort((a, b) => labels.compare(a.label, b.label));

  return (
    <Screen tab="help" back={{ href: "/cases", label: t("cases.title") }}>
      <PageHead title={t("cases.new")} lead={t("cnew.lead")} />

      {check ? (
        <Notice kind="info">
          <p>{t("cnew.fromCheck", { date: date(check.created_at) })}</p>
        </Notice>
      ) : null}

      <Section title={t("cnew.kind")} id="cnew-kind">
        <ChoiceGroup legendId="cnew-kind">
          {CASE_KINDS.map((k) => {
            const Icon = KIND_ICON[k];
            return <ChoiceTile key={k} value={k} checked={kind === k} onChange={() => setKind(k)} picture={<Icon weight="duotone" size={36} />} title={t(`case.kind.${k}` as Key)} description={t(`case.kind.${k}.d` as Key)} />;
          })}
        </ChoiceGroup>
      </Section>

      {kind === "emergency" ? (
        <Notice kind="error" title={t("cnew.danger")} action={t("case.emergency.sos")} actionHref="/sos">
          <p>{t("case.emergency.lead")}</p>
        </Notice>
      ) : null}

      <TextInput label={t("cnew.name")} value={title} onChange={setCustomTitle} maxLength={120} />
      <TextArea label={t("cnew.summary")} hint={t("cnew.summary.help")} value={summary} onChange={setSummary} rows={6} maxLength={4000} error={problem === "need" ? t("cnew.need") : null} />
      <Select label={t("cnew.where")} value={country} onChange={setCountry} options={countries} placeholder={t("common.unknown")} optional />

      <p className={styles.note}>{t("cnew.ladder")}</p>
      {problem === "failed" ? <ErrorNotice kind="save" onRetry={() => void create()} /> : null}

      <StickyActions>
        <Button onClick={() => void create()} busy={busy} disabled={!store} data-testid="create-case">
          {t("cnew.create")}
        </Button>
      </StickyActions>
    </Screen>
  );
}
