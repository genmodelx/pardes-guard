"use client";

import { useEffect, useRef, useState } from "react";
import { IconMicrophone, IconSpeakerHigh, IconStop, IconTrash } from "@/components/icons";
import { MAX_VOICE_SECONDS, useRecorder, type Recorder } from "@/lib/audio";
import { useI18n } from "@/lib/i18n";
import { Button } from "./Button";
import styles from "./VoiceNote.module.css";

/**
 * Record a voice note in your own words. Record, see the time running, stop, listen back, remove.
 * Hidden when the phone cannot record; the typed box beside it always works.
 */
export function VoiceNote({ onChange, disabled = false }: { onChange: (note: Recorder["note"]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const rec = useRecorder();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => onChange(rec.note), [rec.note, onChange]);
  useEffect(() => () => audio.current?.pause(), []);

  if (!rec.available) return null;

  const play = () => {
    if (!rec.note) return;
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    const el = new Audio(rec.note.url);
    audio.current = el;
    el.onended = () => setPlaying(false);
    void el.play().then(() => setPlaying(true), () => setPlaying(false));
  };

  const time = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const message = rec.error === "blocked" ? t("voice.denied") : rec.error === "unsupported" ? t("voice.unsupported") : rec.error === "failed" ? t("voice.failed") : null;

  return (
    <div className={styles.note}>
      {rec.state === "recording" ? (
        <div className={styles.live}>
          <span className={styles.dot} aria-hidden="true" />
          <span role="timer" aria-live="off">
            <bdi dir="ltr">
              {time(rec.seconds)} / {time(MAX_VOICE_SECONDS)}
            </bdi>
          </span>
          <Button variant="danger" full={false} compact icon={<IconStop weight="fill" size={22} />} onClick={rec.stop} data-testid="voice-stop">
            {t("voice.stop")}
          </Button>
        </div>
      ) : rec.state === "converting" ? (
        <p className={styles.status} role="status">
          {t("voice.working")}
        </p>
      ) : rec.note ? (
        <div className={styles.ready}>
          <p className={styles.status} role="status">
            {t("voice.ready", { s: rec.note.seconds })}
          </p>
          <div className={styles.row}>
            <Button variant="secondary" full={false} compact icon={playing ? <IconStop weight="fill" size={22} /> : <IconSpeakerHigh size={22} />} onClick={play} aria-pressed={playing}>
              {playing ? t("common.stop") : t("voice.play")}
            </Button>
            <Button variant="quiet" full={false} compact icon={<IconTrash size={22} />} onClick={rec.clear} disabled={disabled}>
              {t("voice.remove")}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" full icon={<IconMicrophone size={24} />} onClick={() => void rec.start()} disabled={disabled} data-testid="voice-record">
          {t("voice.record")}
        </Button>
      )}
      {rec.hitLimit ? <p className={styles.status}>{t("voice.limit")}</p> : null}
      {message ? (
        <p className={styles.problem} role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
}
