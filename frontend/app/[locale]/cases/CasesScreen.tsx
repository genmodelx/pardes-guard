"use client";

import { useEffect, useState } from "react";
import { IconCaretRight, IconCoins, IconPlus } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { CaseStatusChip, EmergencyChip } from "@/components/ui/CaseParts";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { ErrorNotice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { MenuList, MenuRow } from "@/components/ui/StepRow";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import type { Case } from "@/lib/types";
import styles from "./Cases.module.css";

/** The person's cases, newest change first, and the way to open one. */
export function CasesScreen() {
  const { t, date } = useI18n();
  const { store } = useStore();
  const auth = useAuth();
  const [cases, setCases] = useState<Case[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!store) return;
    let cancelled = false;
    setFailed(false);
    store
      .listCases()
      .then((list) => !cancelled && setCases(list))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [store, attempt]);

  return (
    <Screen tab="help" back={{ href: "/help", label: t("help.title") }}>
      <PageHead title={t("cases.title")} lead={t("cases.lead")} />

      <Button href="/cases/new" icon={<IconPlus weight="bold" size={22} />} data-testid="new-case">
        {t("cases.new")}
      </Button>

      <Section title={t("cases.mine")} id="cases-mine">
        {failed ? <ErrorNotice kind="load" onRetry={() => setAttempt((n) => n + 1)} /> : null}
        {!cases && !failed ? <Skeleton lines={3} label={t("common.loading")} /> : null}
        {cases && !cases.length ? <p className="soft">{t("cases.empty")}</p> : null}
        {cases?.length ? (
          <ul className={styles.list}>
            {cases.map((c) => {
              const waiting = c.ladder.some((s) => s.status === "awaiting_approval");
              return (
                <li key={c.id}>
                  <LocaleLink href={`/cases/view?id=${encodeURIComponent(c.id)}`} className={styles.row} data-testid="case">
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{c.title}</span>
                      <span className={styles.chips}>
                        {c.kind === "emergency" ? <EmergencyChip /> : null}
                        <CaseStatusChip status={c.status} />
                      </span>
                      {waiting ? <span className={styles.waiting}>{t("cases.waitingOne")}</span> : null}
                      <span className="small soft">{t("cases.updated", { date: date(c.updated_at) })}</span>
                    </span>
                    <IconCaretRight weight="bold" size={20} directional className={styles.chevron} />
                  </LocaleLink>
                </li>
              );
            })}
          </ul>
        ) : null}
        {store?.kind === "local" && auth.canSignIn && cases?.length ? <p className="small soft">{t("cases.local")}</p> : null}
      </Section>

      <MenuList>
        <MenuRow href="/wage" icon={<IconCoins weight="duotone" size={26} />} title={t("cases.wage")} description={t("cases.wage.d")} />
      </MenuList>
    </Screen>
  );
}
