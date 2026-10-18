"use client";

import { useEffect, type ReactNode } from "react";
import { AuthProvider } from "@/lib/auth";
import { JourneyProvider, StoreProvider, useJourney } from "@/lib/data";
import { I18nProvider } from "@/lib/i18n";
import { mayDownloadQuietly, registerOfflineKit, saveOfflineKit } from "@/lib/offline-kit";
import type { Dict, UiLocale } from "@/lib/i18n";

/** Everything a screen can ask for through a hook. The dictionary arrives from the build, already in the page's language. */
export function Providers({ locale, dict, children }: { locale: UiLocale; dict: Dict; children: ReactNode }) {
  // Marks the page as live (scripts attached). Browser tests wait for it before they type or pick a
  // file, because a change made to the plain HTML before that is lost.
  useEffect(() => {
    document.documentElement.setAttribute("data-ready", "");
  }, []);
  useEffect(() => registerOfflineKit(), []);
  return (
    <I18nProvider locale={locale} dict={dict}>
      <AuthProvider>
        <StoreProvider>
          <JourneyProvider>
            <KitKeeper locale={locale} />
            {children}
          </JourneyProvider>
        </StoreProvider>
      </AuthProvider>
    </I18nProvider>
  );
}

/**
 * Once the page is quiet, keep this language's key screens and the person's own country packs on
 * the phone (skipped on a data-saver connection; More has the button to do it by hand).
 */
function KitKeeper({ locale }: { locale: UiLocale }) {
  const journey = useJourney();
  const known = journey.status === "ready" || journey.status === "none";
  const packs = [journey.plan?.answers.origin, journey.plan?.answers.destination].filter((c): c is string => Boolean(c)).join(",");
  useEffect(() => {
    if (!known || !mayDownloadQuietly()) return;
    const timer = window.setTimeout(() => void saveOfflineKit(locale, packs ? packs.split(",") : [], true), 8000);
    return () => window.clearTimeout(timer);
  }, [known, locale, packs]);
  return null;
}
