"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IconBriefcase, IconCompass, IconGlobeHemisphereEast, IconGraduationCap, IconHouseLine, IconPlant, IconQuestion } from "@/components/icons";
import { PageHead, Screen, StickyActions } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { ChoiceGroup, ChoiceTile } from "@/components/ui/ChoiceTile";
import { Flag } from "@/components/ui/Flag";
import { ListenButton } from "@/components/ui/ListenButton";
import { ErrorNotice, Notice } from "@/components/ui/Notice";
import { useJourney } from "@/lib/data";
import { cleanAnswers, destinationChoices, originChoices, routeChoices, type JourneyPurpose } from "@/lib/engine/journey";
import { localized } from "@/lib/engine/packs";
import { firebaseEnabled } from "@/lib/firebase";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { useLabels } from "@/lib/labels";
import { PACK_INDEX, indexEntry } from "@/lib/packs";
import styles from "./Start.module.css";

/** "Another country" or "I do not know yet": a real answer, stored as no country. */
const OTHER = "other";

interface Draft {
  purpose: JourneyPurpose | null;
  origin: string | null;
  destination: string | null;
  route_id: string | null;
}

const EMPTY: Draft = { purpose: null, origin: null, destination: null, route_id: null };
const TITLE_ID = "start-question";

const PURPOSE_ICON = { work: IconBriefcase, seasonal: IconPlant, skilled_migration: IconHouseLine, study: IconGraduationCap };

const picture = (Icon: typeof IconBriefcase): ReactNode => <Icon weight="duotone" size={44} />;

/** The three start questions, one per screen. The last answer builds the journey. */
export function Start() {
  const { t, href, locale } = useI18n();
  const labels = useLabels();
  const router = useRouter();
  const params = useSearchParams();
  const journey = useJourney();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [problem, setProblem] = useState<"pick" | "save" | null>(null);
  const [saving, setSaving] = useState(false);
  // Coming back to change answers: begin from what was saved.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || journey.status !== "ready" || !journey.journey) return;
    prefilled.current = true;
    const saved = journey.journey.answers;
    setDraft((d) => (d.purpose ? d : { purpose: saved.purpose, origin: saved.origin ?? OTHER, destination: saved.destination ?? OTHER, route_id: saved.route_id }));
  }, [journey.status, journey.journey]);

  // Which question is on screen. An address that asks for a later question than the answers allow
  // (a reload, an old link) falls back to the first one that is still open.
  const asked = Math.min(4, Math.max(1, Number(params.get("q")) || 1));
  const reachable = !draft.purpose ? 1 : !draft.origin ? 2 : !draft.destination || draft.destination === OTHER ? 3 : 4;
  const q = Math.min(asked, reachable);

  const go = (n: number) => {
    setProblem(null);
    window.history.pushState(null, "", `?q=${n}`);
    window.scrollTo(0, 0);
  };

  // Tell screen-reader users the question changed.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById(TITLE_ID)?.focus();
  }, [q]);

  const origins = useMemo(
    () => originChoices(PACK_INDEX).map((p) => ({ code: p.code, name: labels.country(p.code) ?? p.name })).sort((a, b) => labels.compare(a.name, b.name)),
    [labels],
  );
  const destinations = useMemo(
    () => (draft.purpose ? destinationChoices(PACK_INDEX, draft.purpose) : []).map((p) => ({ code: p.code, name: labels.country(p.code) ?? p.name })).sort((a, b) => labels.compare(a.name, b.name)),
    [draft.purpose, labels],
  );
  const destinationEntry = draft.destination && draft.destination !== OTHER ? indexEntry(draft.destination) : null;
  const routes = useMemo(() => (destinationEntry && draft.purpose ? routeChoices(destinationEntry, draft.purpose) : []), [destinationEntry, draft.purpose]);

  // The last tap is "Show my steps"; before that it is "Next".
  const lastQuestion = q === 4 || (q === 3 && draft.destination !== null && (draft.destination === OTHER || routes.length <= 1));

  const finish = async (answers: Draft) => {
    if (!answers.purpose) return;
    setSaving(true);
    setProblem(null);
    const clean = cleanAnswers(
      {
        purpose: answers.purpose,
        origin: answers.origin === OTHER ? null : answers.origin,
        destination: answers.destination === OTHER ? null : answers.destination,
        route_id: answers.destination === OTHER ? null : answers.route_id,
      },
      PACK_INDEX,
    );
    const ok = await journey.start(clean);
    if (ok) {
      router.push(href("/home"));
    } else {
      setSaving(false);
      setProblem("save");
    }
  };

  const next = () => {
    if (q === 1) return draft.purpose ? go(2) : setProblem("pick");
    if (q === 2) return draft.origin ? go(3) : setProblem("pick");
    if (q === 3) {
      if (!draft.destination) return setProblem("pick");
      if (draft.destination === OTHER) return void finish({ ...draft, route_id: null });
      if (routes.length === 1) return void finish({ ...draft, route_id: routes[0].id });
      if (routes.length === 0) return void finish({ ...draft, route_id: null });
      return go(4);
    }
    return draft.route_id ? void finish(draft) : setProblem("pick");
  };

  const pick = (change: Partial<Draft>) => {
    setProblem(null);
    setDraft((d) => {
      const nextDraft = { ...d, ...change };
      // A new purpose can rule out the country, and a new country always rules out the visa.
      if (change.purpose && change.purpose !== d.purpose) {
        const stillThere = nextDraft.destination === OTHER || destinationChoices(PACK_INDEX, change.purpose).some((p) => p.code === nextDraft.destination);
        if (!stillThere) nextDraft.destination = null;
        nextDraft.route_id = null;
      }
      if (change.destination && change.destination !== d.destination) nextDraft.route_id = null;
      return nextDraft;
    });
  };

  const title = t(q === 1 ? "start.why.title" : q === 2 ? "start.from.title" : q === 3 ? "start.to.title" : "start.route.title");
  const otherDestination = t(draft.purpose === "explore" ? "start.to.unknown" : "start.to.other");

  // What Listen reads: the question, then each answer.
  const spoken = (): string => {
    const options =
      q === 1
        ? [t("start.why.work"), t("start.why.study"), t("start.why.explore")]
        : q === 2
          ? [...origins.map((o) => o.name), t("start.from.other")]
          : q === 3
            ? [...destinations.map((d) => d.name), otherDestination]
            : routes.map((r) => localized(r, locale).name);
    return [title, ...options].join(". ");
  };

  const back = q > 1 ? { onClick: () => window.history.back() } : journey.status === "ready" ? { href: "/journey" } : firebaseEnabled ? { href: "/signin" } : { href: "/?choose=1", plain: true };

  return (
    <Screen bar={false} back={back}>
      <div className={styles.progress}>
        <p className={styles.count}>{t("start.progress", { n: Math.min(q, 3), total: 3 })}</p>
        <span className={styles.segments} aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <span key={n} className={n <= Math.min(q, 3) ? styles.segmentOn : styles.segment} />
          ))}
        </span>
      </div>

      <PageHead title={title} id={TITLE_ID} lead={q === 4 ? t("start.route.help") : undefined}>
        <ListenButton text={spoken} />
      </PageHead>

      {q === 1 ? (
        <ChoiceGroup legendId={TITLE_ID}>
          {(["work", "study", "explore"] as const).map((purpose) => (
            <ChoiceTile
              key={purpose}
              value={purpose}
              checked={draft.purpose === purpose}
              onChange={() => pick({ purpose })}
              picture={picture(purpose === "work" ? IconBriefcase : purpose === "study" ? IconGraduationCap : IconCompass)}
              title={t(`start.why.${purpose}` as Key)}
              description={t(`start.why.${purpose}.d` as Key)}
            />
          ))}
        </ChoiceGroup>
      ) : null}

      {q === 2 ? (
        <>
          <ChoiceGroup legendId={TITLE_ID}>
            {origins.map((o) => (
              <ChoiceTile key={o.code} value={o.code} checked={draft.origin === o.code} onChange={() => pick({ origin: o.code })} picture={<Flag code={o.code} />} title={o.name} />
            ))}
            <ChoiceTile value={OTHER} checked={draft.origin === OTHER} onChange={() => pick({ origin: OTHER })} picture={picture(IconGlobeHemisphereEast)} title={t("start.from.other")} />
          </ChoiceGroup>
          {draft.origin === OTHER ? (
            <Notice kind="info">
              <p>{t("start.from.otherNote")}</p>
            </Notice>
          ) : null}
        </>
      ) : null}

      {q === 3 ? (
        <>
          {destinations.length === 0 ? (
            <Notice kind="info">
              <p>{t("start.to.none")}</p>
            </Notice>
          ) : null}
          <ChoiceGroup legendId={TITLE_ID}>
            {destinations.map((d) => (
              <ChoiceTile key={d.code} value={d.code} checked={draft.destination === d.code} onChange={() => pick({ destination: d.code })} picture={<Flag code={d.code} />} title={d.name} />
            ))}
            <ChoiceTile
              value={OTHER}
              checked={draft.destination === OTHER}
              onChange={() => pick({ destination: OTHER })}
              picture={picture(draft.purpose === "explore" ? IconQuestion : IconGlobeHemisphereEast)}
              title={otherDestination}
            />
          </ChoiceGroup>
          {draft.destination === OTHER && draft.purpose !== "explore" ? (
            <Notice kind="info">
              <p>{t("start.to.otherNote")}</p>
            </Notice>
          ) : null}
        </>
      ) : null}

      {q === 4 ? (
        <ChoiceGroup legendId={TITLE_ID}>
          {routes.map((r) => {
            const name = localized(r, locale).name;
            return (
              <ChoiceTile
                key={r.id}
                value={r.id}
                checked={draft.route_id === r.id}
                onChange={() => pick({ route_id: r.id })}
                picture={picture(PURPOSE_ICON[r.purpose])}
                title={name}
                description={t(`purpose.${r.purpose}` as Key)}
                lang={name === r.name && locale !== "en" ? "en" : undefined}
              />
            );
          })}
        </ChoiceGroup>
      ) : null}

      {problem === "save" ? <ErrorNotice kind="save" /> : null}

      <StickyActions>
        {problem === "pick" ? (
          <p className={styles.pick} role="alert">
            {t("start.pickOne")}
          </p>
        ) : null}
        <Button onClick={next} busy={saving} data-testid="next">
          {lastQuestion ? t("start.finish") : t("common.next")}
        </Button>
      </StickyActions>
    </Screen>
  );
}
