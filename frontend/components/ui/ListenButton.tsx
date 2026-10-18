"use client";

import { IconSpeakerHigh, IconStop } from "@/components/icons";
import { useI18n } from "@/lib/i18n";
import { useListen } from "@/lib/speech";
import { Button } from "./Button";

/**
 * Reads text aloud with the phone's own voice. On every result and document page.
 * Renders nothing when the phone has no voice for the language, so there is never a dead button.
 */
export function ListenButton({ text, lang, full = false }: { text: string | (() => string); lang?: string; full?: boolean }) {
  const { t, locale } = useI18n();
  const listen = useListen(lang ?? locale);
  if (!listen.available) return null;
  return (
    <Button
      variant="secondary"
      compact
      full={full}
      aria-pressed={listen.speaking}
      icon={listen.speaking ? <IconStop weight="fill" size={22} /> : <IconSpeakerHigh size={22} />}
      onClick={() => listen.toggle(typeof text === "function" ? text() : text)}
      data-testid="listen"
    >
      {listen.speaking ? t("common.stop") : t("common.listen")}
    </Button>
  );
}
