"use client";

import { useEffect, useState, type FormEvent } from "react";
import { IconCaretRight, IconMagnifyingGlass } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Field";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { RecruiterStatusChip } from "@/components/ui/RecruiterStatus";
import { Skeleton } from "@/components/ui/Skeleton";
import { SourceChip } from "@/components/ui/SourceChip";
import { localized } from "@/lib/engine/packs";
import type { RecruiterDirectory } from "@/lib/engine/recruiters";
import { rich, useI18n } from "@/lib/i18n";
import { loadPack } from "@/lib/packs";
import { useDirectory } from "@/lib/use-directory";
import type { CountryPack, RecruiterRecord, SourceRef } from "@/lib/types";
import styles from "./Recruiters.module.css";

/** The list is of Pakistan's licensed overseas employment promoters. */
const LIST_COUNTRY = "PK";

export { useDirectory };

/** Who keeps the official list, and their site when the pack lists it. */
export function useListOffice(): { office: string | null; site: SourceRef | null; pack: CountryPack | null } {
  const { locale } = useI18n();
  const [pack, setPack] = useState<CountryPack | null>(null);
  useEffect(() => {
    void loadPack(LIST_COUNTRY).then(setPack);
  }, []);
  const office = pack?.regulator ? (localized(pack, locale).regulator ?? pack.regulator) : null;
  const site = pack?.regulator ? (pack.official_sources.find((s) => pack.regulator?.startsWith(s.title)) ?? null) : null;
  return { office, site, pack };
}

/** Where the real list is: the sample warning, or the source line of an official list. */
export function ListNote({ directory }: { directory: RecruiterDirectory }) {
  const { t, date } = useI18n();
  const { office, site } = useListOffice();
  return directory.isSample ? (
    <Notice kind="warning" title={t("rec.sample.title")}>
      <p>{t("rec.sample.lead")}</p>
      {office ? <p>{t("rec.official", { office })}</p> : null}
      {site ? <SourceChip source={site} /> : null}
    </Notice>
  ) : (
    <p className="small soft">{t("rec.listFrom", { source: office ?? "", date: date(directory.loadedOn) })}</p>
  );
}

function Row({ record }: { record: RecruiterRecord }) {
  const { t } = useI18n();
  return (
    <li>
      <LocaleLink href={`/recruiters/view?licence=${encodeURIComponent(record.license_no)}`} className={styles.row} data-testid="recruiter">
        <span className={styles.rowText}>
          <span className={styles.name} lang="en">
            {record.name}
          </span>
          <span className={styles.meta}>
            <span>
              {rich(t("result.recruiter.licence"), {
                licence: (
                  <bdi dir="ltr" className={styles.licence}>
                    {record.license_no}
                  </bdi>
                ),
              })}
            </span>
            {record.city ? <span lang="en">{record.city}</span> : null}
          </span>
          <RecruiterStatusChip status={record.status} />
        </span>
        <IconCaretRight weight="bold" size={20} directional className={styles.chevron} />
      </LocaleLink>
    </li>
  );
}

/** Look an agent up on the licensed list, by name, city or licence number. */
export function RecruitersScreen() {
  const { t } = useI18n();
  const { directory, failed, retry } = useDirectory();
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [needInput, setNeedInput] = useState(false);

  const search = (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    setNeedInput(!q);
    setAsked(q || null);
  };

  const results = directory ? (asked ? directory.search(asked, 20) : directory.all()) : [];

  return (
    <Screen tab="check" back={{ href: "/home", label: t("common.home") }}>
      <PageHead title={t("rec.title")} lead={t("rec.lead")} />

      {failed ? <ErrorNotice kind="load" onRetry={retry} /> : null}
      {directory ? <ListNote directory={directory} /> : null}

      <form className={styles.search} onSubmit={search} role="search">
        <TextInput label={t("rec.search")} placeholder={t("rec.searchPh")} value={query} onChange={setQuery} error={needInput ? t("rec.needInput") : null} mic={false} name="q" />
        <Button type="submit" variant="secondary" full={false} icon={<IconMagnifyingGlass size={22} />} data-testid="search">
          {t("rec.searchBtn")}
        </Button>
      </form>

      {!directory && !failed ? <Skeleton lines={5} label={t("common.loading")} /> : null}

      {directory ? (
        <Section title={asked ? t("rec.found") : t("rec.all")} id="rec-results">
          {asked ? (
            <Button
              variant="quiet"
              full={false}
              compact
              onClick={() => {
                setAsked(null);
                setQuery("");
              }}
            >
              {t("rec.clear")}
            </Button>
          ) : null}
          {results.length ? (
            <ul className={styles.list} aria-live="polite">
              {results.map((r) => (
                <Row key={r.license_no} record={r} />
              ))}
            </ul>
          ) : (
            <Notice kind="warning" title={directory.isSample ? undefined : t("rec.noResults")}>
              <p>{directory.isSample ? t("rec.noResults.sample") : t("rec.notListed")}</p>
            </Notice>
          )}
        </Section>
      ) : null}
    </Screen>
  );
}
