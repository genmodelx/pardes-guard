"use client";

import { IconArrowSquareOut, IconBank, IconClock, IconMapPin } from "@/components/icons";
import { PageHead, Screen, Section, StickyActions } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Badge, Chip } from "@/components/ui/Chips";
import { Fact, FactList, NotYet, NumberedSteps, TickList } from "@/components/ui/Facts";
import { ListenButton } from "@/components/ui/ListenButton";
import { Notice } from "@/components/ui/Notice";
import { TermList } from "@/components/ui/Sheet";
import { SourceList, WebAddress } from "@/components/ui/SourceChip";
import { useJourney } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { itemHref, useLabels } from "@/lib/labels";
import type { DocumentGuide } from "@/lib/types";
import styles from "./DocumentGuide.module.css";

type GuideField = "title" | "summary" | "issued_by" | "typical_time" | "bring" | "steps";

/**
 * How to get one paper yourself. Every fact comes from the country pack. A fact our team has not
 * added yet says so in its place; the page never fills a gap with a guess.
 */
export function DocumentGuideScreen({ country, guide, english }: { country: string; guide: DocumentGuide; english: readonly GuideField[] }) {
  const { t } = useI18n();
  const labels = useLabels();
  const journey = useJourney();
  /** "en" for a part that has no translation yet, so it is set and read as English. */
  const langOf = (field: GuideField) => (english.includes(field) ? "en" : undefined);

  const where = guide.online_or_office ? t(`docs.where.${guide.online_or_office}`) : null;
  const incomplete = !guide.issued_by || !guide.online_or_office || !guide.typical_time || !guide.bring.length || !guide.steps.length;
  const step = journey.plan?.items.find((i) => i.document?.id === guide.id && i.document.country === country) ?? null;

  const spoken = (): string =>
    [
      guide.title,
      guide.summary ?? "",
      guide.issued_by ? `${t("docs.issuedBy")}: ${guide.issued_by}` : "",
      where ? `${t("docs.where")}: ${where}` : "",
      guide.typical_time ? `${t("docs.time")}: ${guide.typical_time}` : "",
      guide.bring.length ? `${t("docs.bring")}: ${guide.bring.join(", ")}` : "",
      guide.steps.length ? `${t("docs.steps")}: ${guide.steps.map((s, i) => `${i + 1}. ${s}`).join(" ")}` : "",
    ]
      .filter(Boolean)
      .join(". ");

  const official = guide.official_url ? (
    <Button href={guide.official_url} external icon={<IconArrowSquareOut size={22} />} data-testid="official">
      {t("item.official")}
    </Button>
  ) : null;

  return (
    <Screen tab="journey" back={{ href: "/documents", label: t("docs.all") }}>
      <PageHead title={guide.title} lang={langOf("title")}>
        <div className={styles.chips}>
          <Chip icon={<IconMapPin size={18} />}>{labels.country(country)}</Chip>
          {guide.status === "verified" ? <Badge kind="verified" date={guide.last_verified} /> : <Badge kind="draft" long />}
        </div>
      </PageHead>

      {guide.summary ? (
        <p lang={langOf("summary")} dir={langOf("summary") ? "auto" : undefined}>
          {guide.summary}
        </p>
      ) : null}
      <TermList text={`${guide.title} ${guide.summary ?? ""} ${guide.steps.join(" ")}`} />
      <ListenButton text={spoken} lang={langOf("title")} />

      {step ? (
        <Notice kind="info" action={t("docs.openStep")} actionHref={itemHref(step.id)}>
          <p>{t("docs.inJourney")}</p>
        </Notice>
      ) : null}

      <FactList>
        <Fact icon={<IconBank size={24} />} label={t("docs.issuedBy")}>
          {guide.issued_by ? <span lang={langOf("issued_by")}>{guide.issued_by}</span> : <NotYet />}
        </Fact>
        <Fact icon={<IconMapPin size={24} />} label={t("docs.where")}>
          {where ?? <NotYet />}
        </Fact>
        <Fact icon={<IconClock size={24} />} label={t("docs.time")}>
          {guide.typical_time ? <span lang={langOf("typical_time")}>{guide.typical_time}</span> : <NotYet />}
        </Fact>
      </FactList>

      <Section title={t("docs.bring")} id="doc-bring">
        {guide.bring.length ? (
          <TickList items={guide.bring} lang={langOf("bring")} />
        ) : (
          <p>
            <NotYet />
          </p>
        )}
      </Section>

      <Section title={t("docs.steps")} id="doc-steps">
        {guide.steps.length ? (
          <NumberedSteps steps={guide.steps} lang={langOf("steps")} />
        ) : (
          <p>
            <NotYet />
          </p>
        )}
      </Section>

      {incomplete ? (
        <Notice kind="warning">
          <p>{t("docs.notYet.help")}</p>
        </Notice>
      ) : null}

      <Section title={t("docs.official")} id="doc-official">
        {guide.official_url ? <WebAddress url={guide.official_url} /> : null}
        <p className={styles.note}>{t(guide.official_url ? "item.officialNote" : "item.noLink")}</p>
        {guide.sources.length ? <h3>{t("common.sources")}</h3> : null}
        <SourceList sources={guide.sources} checked={guide.last_verified} />
      </Section>

      {official ? <StickyActions>{official}</StickyActions> : null}
    </Screen>
  );
}
