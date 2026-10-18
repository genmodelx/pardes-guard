"use client";

// Voice notes. The phone records in whatever format it likes (WebM or MP4); the note is then turned
// into a small WAV file (16 kHz, mono), a format Gemini is documented to take, so nothing depends on
// which browser recorded it. At most 2 minutes, which is about 4 MB.

import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_VOICE_SECONDS = 120;
const RATE = 16000;

/** PCM samples (-1..1) as a 16-bit mono WAV file. */
export function encodeWav(samples: Float32Array, sampleRate = RATE): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // size of the fmt chunk
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** Any recording the browser can decode, as 16 kHz mono WAV. */
export async function toWav(recording: Blob): Promise<{ wav: Blob; seconds: number }> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await recording.arrayBuffer());
    const seconds = Math.min(decoded.duration, MAX_VOICE_SECONDS);
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(seconds * RATE)), RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination); // a mono destination mixes the channels down
    source.start();
    const rendered = await offline.startRendering();
    return { wav: encodeWav(rendered.getChannelData(0)), seconds: Math.round(seconds) };
  } finally {
    void ctx.close();
  }
}

export type RecorderState = "idle" | "recording" | "converting" | "ready";
export type RecorderError = "blocked" | "unsupported" | "failed";

export interface Recorder {
  available: boolean;
  state: RecorderState;
  error: RecorderError | null;
  /** Seconds recorded so far, or the length of the ready note. */
  seconds: number;
  /** True when the note stopped itself at the 2-minute limit. */
  hitLimit: boolean;
  note: { wav: Blob; url: string; seconds: number } | null;
  start: () => Promise<void>;
  stop: () => void;
  clear: () => void;
}

export function useRecorder(): Recorder {
  const [available, setAvailable] = useState(false);
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<RecorderError | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [hitLimit, setHitLimit] = useState(false);
  const [note, setNote] = useState<Recorder["note"]>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);
  const startedAt = useRef(0);

  useEffect(() => {
    setAvailable(typeof window !== "undefined" && typeof window.MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  const stopTimer = () => {
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
  };

  const stop = useCallback(() => {
    stopTimer();
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setHitLimit(false);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      const name = (e as { name?: string }).name;
      setError(name === "NotAllowedError" || name === "SecurityError" ? "blocked" : name === "NotFoundError" ? "unsupported" : "failed");
      return;
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    recorder.current = rec;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setState("converting");
      try {
        const { wav, seconds: length } = await toWav(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        setNote((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { wav, url: URL.createObjectURL(wav), seconds: length };
        });
        setSeconds(length);
        setState("ready");
      } catch {
        setError("failed");
        setState("idle");
      }
    };
    startedAt.current = Date.now();
    setSeconds(0);
    rec.start(1000);
    setState("recording");
    timer.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_VOICE_SECONDS) {
        setHitLimit(true);
        stop();
      }
    }, 250);
  }, [stop]);

  const clear = useCallback(() => {
    setNote((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
    setSeconds(0);
    setHitLimit(false);
    setState("idle");
  }, []);

  // Leaving the screen stops the microphone.
  useEffect(
    () => () => {
      stopTimer();
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    },
    [],
  );

  return { available, state, error, seconds, hitLimit, note, start, stop, clear };
}
