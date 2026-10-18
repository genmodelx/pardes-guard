"use client";

import { useEffect, useState } from "react";
import { IconArrowSquareOut, IconClock } from "@/components/icons";
import { JourneyGate, type ReadyJourney } from "@/components/shell/JourneyGate";
import { JourneyPassport } from "@/components/shell/JourneyPassport";
import { PageHead, Screen, Section, StickyActions } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Badge, StatusIcon, WhoChip } from "@/components/ui/Chips";
import { ChoiceGroup, ChoiceTile } from "@/components/ui/ChoiceTile";
import { ListenButton } from "@/components/ui/ListenButton";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { TermList } from "@/components/ui/Sheet";
import { SourceList, WebAddress } from "@/components/ui/SourceChip";
import { statusOf, type ItemStatus } from "@/lib/engine/journey";
import { useI18n } from "@/lib/i18n";
import { documentHref, itemHref, useLabels } from "@/lib/labels";
import { useQueryParam } from "@/lib/query";
import styles from "./Item.module.css";

const STATUSES: ItemStatus[] = ["todo", "doing", "done", "skipped"];

function Item({ id, plan, journey, setStatus, saveFailed, reload }: ReadyJourney & { id: string | null }) {
  const { t } = useI18n();
  const labels = useLabels();
  const [saved, setSaved] = useState(false);

  // "Saved" shows for a moment after a change, then goes away.
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);
  // A different step: forget the last step's "Saved".
  useEffect(() => setSaved(false), [id]);

  const index = plan.items.findIndex((i) => i.id === id);
  const item = plan.items[index];
  if (!item) {
    return (
      <Notice kind="info" action={t("item.backToJourney")} actionHref="/journey">
        <p>{t("item.notFound")}</p>
      </Notice>
    );
  }

  const status = statusOf(journey, item.id);
  const title = labels.itemTitle(item);
  const description = labels.itemDescription(item);
  const lang = labels.itemLang(item);
  const next = plan.items[index + 1] ?? null;
  const guide = item.document ? documentHref(item.document.country, item.document.id) : null;

  const change = async (value: string) => {
    setSaved(false);
    const ok = await setStatus(item.id, value as ItemStatus);
    setSaved(ok);
  };

  const official = item.official_url ? (
    <Button variant={item.href || guide ? "secondary" : "primary"} full href={item.official_url} external icon={<IconArrowSquareOut size={22} />} data-testid="official">
      {t("item.official")}
    </Button>
  ) : null;

  return (
    <>
      <PageHead title={title} lang={lang}>
        <p className={styles.stage}>{t("item.stage", { stage: labels.stage(item.stage) })}</p>
        <div className={styles.chips}>
          <WhoChip who={item.who} />
          {item.content === "draft" ? <Badge kind="draft" long /> : null}
          {item.content === "verified" ? <Badge kind="verified" date={item.last_verified} /> : null}
        </div>
      </PageHead>

      {description ? (
        <p lang={lang} dir={lang ? "auto" : undefined}>
          {description}
        </p>
      ) : null}
      {item.typical_duration ? (
        <p className={styles.fact}>
          <IconClock size={22} className={styles.factIcon} />
          <span>{t("item.usually", { d: item.typical_duration })}</span>
        </p>
      ) : null}
      <TermList text={`${title} ${description}`} />
      <ListenButton text={`${title}. ${description}`} lang={lang} />
      {item.id === "doc:passport" || item.app === "readiness" ? <JourneyPassport more={item.app === "readiness" ? undefined : { href: "/documents/scan", label: t("deadline.open") }} /> : null}

      <Section title={t("item.status")} id="item-status">
        <ChoiceGroup legendId="item-status" dense>
          {STATUSES.map((value) => (
            <ChoiceTile key={value} value={value} checked={status === value} onChange={change} picture={<StatusIcon status={value} size={28} muted={status !== value} />} title={t(`status.${value}`)} />
          ))}
        </ChoiceGroup>
        <p className={styles.saved} role="status">
          {saved ? t("item.saved") : ""}
        </p>
        {saveFailed ? <ErrorNotice kind="save" onRetry={reload} /> : null}
      </Section>

      {item.kind !== "app" ? (
        <Section title={t("docs.official")} id="item-official">
          {item.official_url ? <WebAddress url={item.official_url} /> : null}
          {official && (item.href || guide) ? official : null}
          <p className={styles.note}>{t(item.official_url ? "item.officialNote" : "item.noLink")}</p>
          {item.sources.length ? <h3>{t("common.sources")}</h3> : null}
          <SourceList sources={item.sources} checked={item.last_verified} />
        </Section>
      ) : null}

      {next ? (
        <Button variant="secondary" full href={itemHref(next.id)} data-testid="next-item">
          {t("item.next")}: {labels.itemTitle(next)}
        </Button>
      ) : null}

      {item.href || guide || official ? (
        <StickyActions>
          {item.href ? (
            <Button href={item.href} data-testid="do">
              {t("item.go")}
            </Button>
          ) : guide ? (
            <Button href={guide} data-testid="guide">
              {t("item.guide")}
            </Button>
          ) : (
            official
          )}
        </StickyActions>
      ) : null}
    </>
  );
}

/** One step of the journey: what it is, who does it, where it stands, and the way to do it. */
export function ItemScreen() {
  const { t } = useI18n();
  const id = useQueryParam("id");
  return (
    <Screen tab="journey" back={{ href: "/journey", label: t("journey.title") }}>
      <JourneyGate lines={5}>{(ready) => <Item id={id} {...ready} />}</JourneyGate>
    </Screen>
  );
}
