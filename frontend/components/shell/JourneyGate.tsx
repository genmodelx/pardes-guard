"use client";

import type { ReactNode } from "react";
import { IconPath } from "@/components/icons";
import { Button } from "@/components/ui/Button";
import { ErrorNotice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { useJourney, type JourneyState } from "@/lib/data";
import type { Journey, JourneyPlan, Progress } from "@/lib/engine/journey";
import { useI18n } from "@/lib/i18n";

/** The invitation to answer the three questions. Shown wherever a journey is needed and there is none. */
export function StartPrompt() {
  const { t } = useI18n();
  return (
    <Panel title={t("home.start.title")}>
      <p>{t("home.start.lead")}</p>
      <Button href="/start" icon={<IconPath size={24} />} data-testid="start">
        {t("home.start.cta")}
      </Button>
    </Panel>
  );
}

export type ReadyJourney = Omit<JourneyState, "journey" | "plan" | "progress"> & { journey: Journey; plan: JourneyPlan; progress: Progress };

/**
 * Wraps the part of a screen that needs the person's journey. While it loads there is a skeleton;
 * if it cannot load there is an error with a retry; with no journey yet there is the start prompt.
 * A screen never has to handle those three cases itself.
 */
export function JourneyGate({ children, lines = 4 }: { children: (ready: ReadyJourney) => ReactNode; lines?: number }) {
  const state = useJourney();
  const { t } = useI18n();
  if (state.status === "loading") return <Skeleton block lines={lines} label={t("common.loading")} />;
  if (state.status === "error") return <ErrorNotice kind="load" onRetry={state.reload} />;
  if (state.status === "none" || !state.journey || !state.plan || !state.progress) return <StartPrompt />;
  return <>{children({ ...state, journey: state.journey, plan: state.plan, progress: state.progress })}</>;
}
