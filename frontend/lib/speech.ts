"use client";

// Voice out (Listen) and voice in (Speak), using what the phone already has.
// Phones differ a lot: a language may have no voice installed, and speech recognition needs a
// connection. So both hooks report `available`, and the buttons hide themselves when it is false.

import { useCallback, useEffect, useRef, useState } from "react";
import { languageInfo } from "@/lib/i18n/config";

const baseOf = (tag: string) => tag.replace("_", "-").toLowerCase().split("-")[0];

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

/** The phone's voice for a language, or null. Android reports tags like "ur_PK". */
export function voiceFor(lang: string, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const wanted = languageInfo(lang).speech.toLowerCase();
  const base = baseOf(lang);
  // Tagalog and Filipino are the same voice on most phones.
  const bases = base === "fil" ? ["fil", "tl"] : [base];
  const candidates = voices.filter((v) => bases.includes(baseOf(v.lang)));
  return candidates.find((v) => v.lang.replace("_", "-").toLowerCase() === wanted) ?? candidates[0] ?? null;
}

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const s = synth();
    if (!s) return;
    const load = () => setVoices(s.getVoices());
    load();
    // Chrome fills the list a moment after the page loads.
    s.addEventListener?.("voiceschanged", load);
    return () => s.removeEventListener?.("voiceschanged", load);
  }, []);
  return voices;
}

export interface Listen {
  /** False when the phone has no voice for this language. Hide the button then. */
  available: boolean;
  speaking: boolean;
  /** Start reading `text`, or stop if it is already reading. */
  toggle: (text: string) => void;
  stop: () => void;
}

export function useListen(lang: string): Listen {
  const voices = useVoices();
  const voice = voiceFor(lang, voices);
  const [speaking, setSpeaking] = useState(false);
  const mine = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    const s = synth();
    if (s && mine.current) s.cancel();
    mine.current = null;
    setSpeaking(false);
  }, []);

  useEffect(() => stop, [stop]);

  const toggle = useCallback(
    (text: string) => {
      const s = synth();
      if (!s || !voice) return;
      if (mine.current) {
        stop();
        return;
      }
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang.replace("_", "-");
      u.rate = 0.92; // a little slower than default; easier to follow
      const done = () => {
        if (mine.current === u) {
          mine.current = null;
          setSpeaking(false);
        }
      };
      u.onend = done;
      u.onerror = done;
      mine.current = u;
      setSpeaking(true);
      s.speak(u);
    },
    [voice, stop],
  );

  return { available: voice !== null, speaking, toggle, stop };
}

// ---- Speech input -------------------------------------------------------------------------------

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

function recognitionCtor(): (new () => RecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type DictationError = "blocked" | "nothing-heard" | "failed";

export interface Dictation {
  /** False when this browser has no speech recognition. Hide the button then. */
  available: boolean;
  listening: boolean;
  error: DictationError | null;
  start: () => void;
  stop: () => void;
}

/** Speech to text for one field. `onText` receives each finished phrase. */
export function useDictation(lang: string, onText: (text: string) => void): Dictation {
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<DictationError | null>(null);
  const active = useRef<RecognitionLike | null>(null);
  const handler = useRef(onText);
  handler.current = onText;

  useEffect(() => {
    setAvailable(recognitionCtor() !== null);
    return () => active.current?.abort();
  }, []);

  const stop = useCallback(() => {
    active.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || active.current) return;
    const rec = new Ctor();
    rec.lang = languageInfo(lang).speech;
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let heard = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal && r[0].transcript.trim()) {
          heard = true;
          handler.current(r[0].transcript.trim());
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setError("blocked");
      else if (e.error === "no-speech") setError("nothing-heard");
      else if (e.error !== "aborted") setError("failed");
    };
    rec.onend = () => {
      active.current = null;
      setListening(false);
      if (!heard) setError((prev) => prev ?? "nothing-heard");
    };
    setError(null);
    active.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      active.current = null;
      setListening(false);
      setError("failed");
    }
  }, [lang]);

  return { available, listening, error, start, stop };
}
