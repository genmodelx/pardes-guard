"use client";

import { useEffect, useMemo, useState } from "react";
import { IconArrowSquareOut, IconDoorOpen, IconScales, IconWhatsappLogo } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Chips";
import { Select } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { SourceList } from "@/components/ui/SourceChip";
import { useJourney } from "@/lib/data";
import { isTranslated, localizedPack } from "@/lib/engine/packs";
import { useI18n } from "@/lib/i18n";
import { useLabels } from "@/lib/labels";
import { PACK_INDEX, loadPack } from "@/lib/packs";
import type { Channel, CountryPack } from "@/lib/types";
import styles from "./Sos.module.css";

function Contact({ channel }: { channel: Channel }) {
  const { t, locale } = useI18n();
  // A name with no translation yet stays English, and is marked as English.
  const lang = (field: string) => (isTranslated(channel, locale, field) ? undefined : "en");
  return (
    <Panel>
      <p className={styles.name} lang={lang("name")}>
        {channel.name}
      </p>
      {channel.description ? <p lang={lang("description")}>{channel.description}</p> : null}
      {channel.url ? (
        <Button variant="secondary" compact full={false} href={channel.url} external icon={<IconArrowSquareOut size={20} />}>
          {t("sos.website")}
        </Button>
      ) : null}
    </Panel>
  );
}

/** Everything the pack holds for one country: where to complain, the embassy, the official sites. */
function CountryContacts({ pack, heading }: { pack: CountryPack; heading: string }) {
  const { t, locale } = useI18n();
  const shown = useMemo(() => localizedPack(pack, locale), [pack, locale]);
  const nothing = !shown.complaint_channels.length && !shown.embassy_contacts.length;
  return (
    <Section title={heading} id={`sos-${pack.code}`}>
      {pack.status === "draft" ? (
        <div>
          <Badge kind="draft" long />
        </div>
      ) : null}
      {shown.regulator ? (
        <p>
          <span className={styles.label}>{t("sos.regulator")}: </span>
          <span lang={isTranslated(pack, locale, "regulator") ? undefined : "en"}>{shown.regulator}</span>
        </p>
      ) : null}
      {shown.complaint_channels.length ? (
        <>
          <h3>{t("sos.complaints")}</h3>
          <div className={styles.contacts}>
            {shown.complaint_channels.map((c) => (
              <Contact key={c.name} channel={c} />
            ))}
          </div>
        </>
      ) : null}
      {shown.embassy_contacts.length ? (
        <>
          <h3>{t("sos.embassy")}</h3>
          <div className={styles.contacts}>
            {shown.embassy_contacts.map((c) => (
              <Contact key={c.name} channel={c} />
            ))}
          </div>
        </>
      ) : null}
      {nothing ? (
        <Notice kind="warning">
          <p>{t("sos.none")}</p>
        </Notice>
      ) : null}
      {shown.official_sources.length ? (
        <>
          <h3>{t("sos.official")}</h3>
          <SourceList sources={shown.official_sources} checked={pack.last_verified} />
        </>
      ) : null}
    </Section>
  );
}

/**
 * Emergency help: a fast way off this screen, and who to contact in the person's two countries.
 * Contacts come only from the country packs. Where a pack has none yet, the screen says so.
 */
export function Sos() {
  const { t } = useI18n();
  const labels = useLabels();
  const journey = useJourney();
  const [other, setOther] = useState("");
  const [otherPack, setOtherPack] = useState<CountryPack | null>(null);

  useEffect(() => {
    if (!other) {
      setOtherPack(null);
      return;
    }
    let cancelled = false;
    void loadPack(other).then((pack) => {
      if (!cancelled) setOtherPack(pack);
    });
    return () => {
      cancelled = true;
    };
  }, [other]);

  // Hide this screen at once, then swap it for a plain page. `replace` keeps SOS out of the
  // Back history, so the Back button does not bring this screen up again.
  const quickExit = () => {
    document.documentElement.style.visibility = "hidden";
    window.location.replace("/exit/");
  };

  const { origin, destination } = journey;
  const shownCodes = [destination?.code, origin?.code].filter(Boolean);
  const others = PACK_INDEX.filter((p) => !shownCodes.includes(p.code))
    .map((p) => ({ value: p.code, label: labels.country(p.code) ?? p.name }))
    .sort((a, b) => labels.compare(a.label, b.label));

  return (
    <Screen back={{ href: "/home", label: t("common.home") }}>
      <PageHead title={t("sos.title")} lead={t("sos.lead")} />

      <div className={styles.exit}>
        <Button variant="danger" onClick={quickExit} icon={<IconDoorOpen weight="bold" size={24} />} data-testid="quick-exit">
          {t("sos.exit")}
        </Button>
        <p className={styles.note}>{t("sos.exit.help")}</p>
      </div>

      <div className={styles.reach}>
        <Button variant="secondary" full href={`https://wa.me/?text=${encodeURIComponent(t("sos.whatsapp.text"))}`} external icon={<IconWhatsappLogo size={24} />} data-testid="sos-whatsapp">
          {t("sos.whatsapp")}
        </Button>
        <p className={styles.note}>{t("sos.whatsapp.help")}</p>
        <Button variant="secondary" full href="/cases/new?kind=emergency" icon={<IconScales size={24} />} data-testid="sos-case">
          {t("sos.case")}
        </Button>
        <p className={styles.note}>{t("sos.case.d")}</p>
      </div>

      {journey.status === "loading" ? <Skeleton lines={4} label={t("common.loading")} /> : null}
      {destination ? <CountryContacts pack={destination} heading={t("sos.there", { country: labels.country(destination.code) ?? destination.name })} /> : null}
      {origin ? <CountryContacts pack={origin} heading={t("sos.home", { country: labels.country(origin.code) ?? origin.name })} /> : null}
      {journey.status === "none" ? (
        <Notice kind="info" action={t("home.start.cta")} actionHref="/start">
          <p>{t("sos.pick")}</p>
        </Notice>
      ) : null}

      <Section title={t("sos.other")} id="sos-other">
        <Select label={t("sos.other.pick")} value={other} onChange={setOther} options={others} placeholder="" />
      </Section>
      {otherPack ? <CountryContacts pack={otherPack} heading={labels.country(otherPack.code) ?? otherPack.name} /> : null}
    </Screen>
  );
}
