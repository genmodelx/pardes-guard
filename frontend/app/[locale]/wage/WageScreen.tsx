"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconCalculator, IconScales, IconVault } from "@/components/icons";
import { PageHead, Screen, Section, StickyActions } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { MoneyInput, moneyFrom, type MoneyValue } from "@/components/ui/MoneyInput";
import { Notice } from "@/components/ui/Notice";
import { SeverityChip } from "@/components/ui/Verdict";
import { setCaseDraft } from "@/lib/case-draft";
import { useJourney } from "@/lib/data";
import { checkWage } from "@/lib/engine/wage";
import { useFlagWords } from "@/lib/flag-text";
import { useI18n } from "@/lib/i18n";
import { indexEntry } from "@/lib/packs";
import type { WageCheckResult } from "@/lib/types";
import styles from "./Wage.module.css";

/** "2026-09" as "September 2026" in the reader's language. */
function useMonthName(): (month: string) => string {
  const { locale, info } = useI18n();
  return (month) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return month;
    try {
      return new Intl.DateTimeFormat(info.intl, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
    } catch {
      return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
    }
  };
}

/** Was I paid right? Code compares one payment with the contract: short pay and late pay. */
export function WageScreen() {
  const { t, href } = useI18n();
  const router = useRouter();
  const journey = useJourney();
  const words = useFlagWords(journey.origin);
  const monthName = useMonthName();

  const [contract, setContract] = useState<MoneyValue>({ amount: "", currency: "SAR" });
  const [paid, setPaid] = useState<MoneyValue>({ amount: "", currency: "SAR" });
  const [month, setMonth] = useState("");
  const [payDay, setPayDay] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [result, setResult] = useState<WageCheckResult | null>(null);
  const [need, setNeed] = useState(false);

  // Amounts start in the currency of the country the person works in.
  useEffect(() => {
    const currency = indexEntry(journey.plan?.answers.destination ?? null)?.currency;
    if (!currency) return;
    setContract((m) => (m.amount ? m : { ...m, currency }));
    setPaid((m) => (m.amount ? m : { ...m, currency }));
  }, [journey.plan?.answers.destination]);

  const compare = () => {
    const contractMoney = moneyFrom(contract, "month");
    const paidMoney = moneyFrom(paid, "month");
    if (!contractMoney || !paidMoney) {
      setNeed(true);
      setResult(null);
      return;
    }
    setNeed(false);
    const day = Number(payDay);
    setResult(
      checkWage({
        contract_salary: contractMoney,
        paid: paidMoney,
        expected_pay_day: Number.isInteger(day) && day >= 1 && day <= 31 ? day : null,
        paid_on: /^\d{4}-\d{2}-\d{2}$/.test(paidOn) ? paidOn : null,
        period_month: /^\d{4}-\d{2}$/.test(month) ? month : null,
      }),
    );
  };

  const problems = result?.flags.filter((f) => f.code === "WAGE_SHORT" || f.code === "WAGE_LATE") ?? [];

  const openCase = () => {
    if (!result) return;
    const short = problems.some((f) => f.code === "WAGE_SHORT");
    const id = setCaseDraft({
      kind: short ? "wage_short" : "wage_late",
      title: month ? t("wage.caseTitle", { month: monthName(month) }) : t(short ? "case.kind.wage_short" : "case.kind.wage_late"),
      summary: problems.map((f) => words.explanation(f).text).join("\n"),
      destination_country: journey.plan?.answers.destination ?? null,
    });
    router.push(href(`/cases/new?draft=${id}`));
  };

  return (
    <Screen tab="help" back={{ href: "/cases", label: t("cases.title") }}>
      <PageHead title={t("wage.title")} lead={t("wage.lead")} />

      <div className={styles.fields}>
        <MoneyInput label={t("wage.contract")} value={contract} onChange={setContract} error={need && !moneyFrom(contract) ? t("wage.need") : null} />
        <MoneyInput label={t("wage.paid")} value={paid} onChange={setPaid} error={need && !moneyFrom(paid) ? t("wage.need") : null} />
        <TextInput label={t("wage.month")} type="month" value={month} onChange={setMonth} ltr mic={false} optional />
        <TextInput label={t("wage.payDay")} value={payDay} onChange={(v) => setPayDay(v.replace(/[^\d]/g, "").slice(0, 2))} inputMode="numeric" ltr mic={false} optional />
        <TextInput label={t("wage.paidOn")} type="date" value={paidOn} onChange={setPaidOn} ltr mic={false} optional />
      </div>

      {result ? (
        <Section title={t("wage.result")} id="wage-result">
          {result.flags.length ? (
            <ul className={styles.flags}>
              {result.flags.map((f) => {
                const title = words.title(f);
                const explanation = words.explanation(f);
                return (
                  <li key={f.code} className={styles.flag} data-code={f.code}>
                    <SeverityChip severity={f.severity} />
                    <h3 lang={title.lang}>{title.text}</h3>
                    <p lang={explanation.lang}>{explanation.text}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Notice kind="success">
              <p>{t("wage.ok")}</p>
            </Notice>
          )}
          {problems.length ? (
            <Button variant="secondary" full icon={<IconScales size={22} />} onClick={openCase} data-testid="wage-case">
              {t("wage.openCase")}
            </Button>
          ) : null}
          <p className="small soft">{t("wage.keep")}</p>
          <Button variant="quiet" full={false} href="/vault" icon={<IconVault size={22} />}>
            {t("vault.title")}
          </Button>
        </Section>
      ) : null}

      <StickyActions>
        <Button onClick={compare} icon={<IconCalculator size={24} />} data-testid="wage-compare">
          {t("wage.submit")}
        </Button>
      </StickyActions>
    </Screen>
  );
}
