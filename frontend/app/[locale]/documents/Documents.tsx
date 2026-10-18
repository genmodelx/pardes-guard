"use client";

import { IconFileText, IconListChecks } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Badge } from "@/components/ui/Chips";
import { ErrorNotice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { MenuList, MenuRow, StepList, StepRow } from "@/components/ui/StepRow";
import { useJourney } from "@/lib/data";
import { statusOf, type PackIndexEntry } from "@/lib/engine/journey";
import { localized } from "@/lib/engine/packs";
import { useI18n } from "@/lib/i18n";
import { documentHref, itemHref, useLabels } from "@/lib/labels";
import { PACK_INDEX } from "@/lib/packs";
import styles from "./Documents.module.css";

/** Every guide a country's pack has, except the ones already listed for the journey. */
function CountryGuides({ pack, title, skip }: { pack: PackIndexEntry; title: string; skip: Set<string> }) {
  const { locale } = useI18n();
  const guides = pack.documents.filter((d) => !skip.has(`${pack.code}:${d.id}`));
  if (!guides.length) return null;
  return (
    <Section title={title} id={`docs-${pack.code}`}>
      <MenuList>
        {guides.map((d) => {
          const name = localized(d, locale).title;
          return <MenuRow key={d.id} href={documentHref(pack.code, d.id)} icon={<IconFileText weight="duotone" size={26} />} title={name} />;
        })}
      </MenuList>
    </Section>
  );
}

/** The documents guide: the papers for this person's journey first, then everything else we have. */
export function Documents() {
  const { t } = useI18n();
  const labels = useLabels();
  const j = useJourney();

  // Every step of the journey that is about a paper: the route's documents, and checklist steps
  // that have a guide (Protector registration). Each guide is listed once.
  const seen = new Set<string>();
  const papers = (j.status === "ready" && j.plan ? j.plan.items : []).filter((i) => {
    if (i.app) return false;
    if (!i.document) return i.kind === "document";
    const key = `${i.document.country}:${i.document.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // With a journey, only the person's two countries are shown. Without one, every guide we have.
  const mine = j.plan ? [j.plan.answers.origin, j.plan.answers.destination] : [];
  const packs = PACK_INDEX.filter((p) => p.documents.length > 0 && (!j.plan || mine.includes(p.code)));

  return (
    <Screen tab="journey" back={{ href: "/home", label: t("common.home") }}>
      <PageHead title={t("docs.title")} lead={t("docs.lead")} />

      <MenuList>
        <MenuRow href="/documents/scan" icon={<IconListChecks weight="duotone" size={26} />} title={t("app.readiness")} description={t("app.readiness.d")} />
      </MenuList>

      {j.status === "loading" ? <Skeleton lines={4} label={t("common.loading")} /> : null}
      {j.status === "error" ? <ErrorNotice kind="load" onRetry={j.reload} /> : null}

      {papers.length ? (
        <Section title={t("docs.forRoute")} id="docs-journey">
          <div className={styles.sheet}>
            <StepList>
              {papers.map((item) => (
                <StepRow
                  key={item.id}
                  href={item.document ? documentHref(item.document.country, item.document.id) : itemHref(item.id)}
                  status={statusOf(j.journey, item.id)}
                  title={labels.itemTitle(item)}
                  lang={labels.itemLang(item)}
                  meta={item.content === "draft" ? <Badge kind="draft" /> : item.content === "verified" ? <Badge kind="verified" date={item.last_verified} /> : null}
                />
              ))}
            </StepList>
          </div>
        </Section>
      ) : null}

      {j.status !== "loading"
        ? packs.map((pack) => {
            const country = labels.country(pack.code) ?? pack.name;
            return <CountryGuides key={pack.code} pack={pack} skip={seen} title={t(papers.length && mine.includes(pack.code) ? "docs.other" : "docs.from", { country })} />;
          })
        : null}

      {j.status !== "loading" && !papers.length && !packs.length ? <p>{t("docs.none")}</p> : null}
    </Screen>
  );
}
