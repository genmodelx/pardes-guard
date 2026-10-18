"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { IconChalkboardTeacher, IconKeyboard, IconMicrophone, IconPaperPlaneTilt, IconStop, IconWaveform } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { ChatLog, type ChatLine } from "@/components/ui/ChatLog";
import { Badge, Chip } from "@/components/ui/Chips";
import { Select, TextArea } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { SourceList } from "@/components/ui/SourceChip";
import type { AiFailure, ChatTurn } from "@/lib/ai";
import { aiProvider } from "@/lib/ai-firebase";
import { useJourney } from "@/lib/data";
import { isTranslated, localized } from "@/lib/engine/packs";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { interviewSystem, interviewTurn, scoreInterview, type Answered, type Scorecard, type TranscriptLine } from "@/lib/interview";
import { useLabels } from "@/lib/labels";
import type { LiveFailure } from "@/lib/live";
import { PACK_INDEX, loadPack } from "@/lib/packs";
import { PROMPTS } from "@/lib/prompts";
import type { CountryPack } from "@/lib/types";
import { useLiveTalk } from "@/lib/use-live-talk";
import styles from "./Interview.module.css";

type Phase = "ready" | "text" | "voice" | "scoring" | "card";

const ANSWERED_TONE: Record<Answered, "ok" | "amber" | "neutral"> = { yes: "ok", partly: "amber", no: "neutral" };

/** Every route whose pack lists interview topics. Only those can be practised. */
const PRACTICE_ROUTES = PACK_INDEX.flatMap((pack) => pack.routes.filter((r) => (r.interview_topics ?? 0) > 0).map((route) => ({ country: pack.code, route })));

/**
 * Interview practice: an AI interviewer asks about the route's own topics, by voice or in text, then
 * gives feedback per topic. It is practice: nothing here predicts or decides a visa.
 */
export function InterviewScreen() {
  const { t, locale } = useI18n();
  const labels = useLabels();
  const journey = useJourney();
  const ai = aiProvider();
  const language = journey.settings.ai_language ?? locale;

  const mine = journey.plan?.answers.route_id ?? null;
  const [routeId, setRouteId] = useState("");
  useEffect(() => {
    if (routeId || journey.status === "loading") return;
    setRouteId(PRACTICE_ROUTES.find((c) => c.route.id === mine)?.route.id ?? PRACTICE_ROUTES[0]?.route.id ?? "");
  }, [routeId, mine, journey.status]);
  const choice = PRACTICE_ROUTES.find((c) => c.route.id === routeId) ?? null;

  const [pack, setPack] = useState<CountryPack | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadPack(choice?.country).then((p) => {
      if (!cancelled) setPack(p);
    });
    return () => {
      cancelled = true;
    };
  }, [choice?.country]);
  const route = pack?.visa_routes.find((r) => r.id === routeId) ?? null;
  const shown = useMemo(() => (route ? localized(route, locale) : null), [route, locale]);
  // The interviewer works from the English pack; the screen shows the person's language.
  const topics = route?.interview_topics ?? [];
  const shownTopics = shown?.interview_topics ?? topics;
  const topicLang = route && isTranslated(route, locale, "interview_topics") ? undefined : "en";
  const routeTitle = (country: string, name: string) => t("interview.routeOption", { route: name, country: labels.country(country) ?? country });

  const [phase, setPhase] = useState<Phase>("ready");
  const [transcript, setTranscriptState] = useState<TranscriptLine[]>([]);
  const said = useRef<TranscriptLine[]>([]);
  const setTranscript = (next: TranscriptLine[]) => {
    said.current = next;
    setTranscriptState(next);
  };
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [card, setCard] = useState<Scorecard | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const englishRoute = route && pack ? `${pack.name} ${route.name}` : "";
  const system = () => interviewSystem(PROMPTS, englishRoute, topics, language);
  const failText = (reason: AiFailure) => t(`interview.fail.${reason}` as Key);

  const score = async (lines: TranscriptLine[]) => {
    if (!lines.some((l) => l.who === "you" && l.text.trim())) {
      setPhase("ready");
      setProblem(t("interview.noAnswers"));
      return;
    }
    setPhase("scoring");
    const abort = new AbortController();
    controller.current = abort;
    const out = await scoreInterview(lines, englishRoute, topics, { ai, prompts: PROMPTS, language, signal: abort.signal });
    if (abort.signal.aborted) return;
    setCard(out.ok ? out.card : null);
    setPhase("card");
    // Practising the journey's own visa ticks off its interview step.
    const step = journey.plan?.items.find((i) => i.app === "interview");
    if (step && routeId === mine && journey.journey?.items[step.id]?.status !== "done") await journey.setStatus(step.id, "done");
  };

  // Spoken lines join the transcript. When Google closes the line by itself, the practice ends there.
  const talk = useLiveTalk((talked) => {
    const lines = [...said.current, ...talked.lines];
    setTranscript(lines);
    if (talked.endedByService) {
      setProblem(t("live.ended"));
      void score(lines);
    }
  });

  const startVoice = async () => {
    setProblem(null);
    setPhase("voice");
    const failed = await talk.start({ system: system() });
    if (failed) {
      setPhase("ready");
      setProblem(t(`live.fail.${failed satisfies LiveFailure}` as Key));
    }
  };

  const ask = async (text: string | null) => {
    const before = said.current;
    if (text) setTranscript([...before, { who: "you", text }]);
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    const out = await interviewTurn(history, text, { ai, system: system(), signal: abort.signal });
    if (abort.signal.aborted) return;
    setBusy(false);
    if (out.ok) {
      setHistory(out.history);
      setTranscript([...said.current, { who: "coach", text: out.reply }]);
      return;
    }
    // Nothing was kept: the answer goes back into the box to send again.
    setTranscript(before);
    if (text) setAnswer(text);
    setProblem(failText(out.reason));
    if (!before.length) setPhase("ready");
  };

  const startText = () => {
    setProblem(null);
    setPhase("text");
    void ask(null);
  };

  const sendAnswer = (e: FormEvent) => {
    e.preventDefault();
    const text = answer.trim();
    if (!text || busy) return;
    setAnswer("");
    setProblem(null);
    void ask(text.slice(0, 2000));
  };

  const end = async () => {
    controller.current?.abort();
    setBusy(false);
    setProblem(null);
    const lines = talk.state !== "off" ? [...said.current, ...(await talk.stop()).lines] : said.current;
    await score(lines);
  };

  const again = () => {
    controller.current?.abort();
    setPhase("ready");
    setTranscript([]);
    setHistory([]);
    setAnswer("");
    setCard(null);
    setProblem(null);
  };

  const changeRoute = (id: string) => {
    if (phase !== "ready" && phase !== "card") return;
    again();
    setRouteId(id);
  };

  const lines: ChatLine[] = [...transcript, ...talk.lines].map((l) => ({ who: l.who === "you" ? "you" : "other", text: l.text }));
  const practising = phase === "text" || phase === "voice";
  const ownHasNone = !!mine && !PRACTICE_ROUTES.some((c) => c.route.id === mine);
  const back = journey.plan ? { href: "/journey", label: t("journey.title") } : { href: "/help", label: t("help.title") };

  return (
    <Screen tab={journey.plan ? "journey" : "help"} back={back}>
      <PageHead title={t("interview.title")} lead={t("interview.lead")}>
        <Badge kind="practice" />
      </PageHead>

      {ownHasNone ? (
        <Notice kind="info">
          <p>{t("interview.none")}</p>
        </Notice>
      ) : null}

      {PRACTICE_ROUTES.length > 1 ? (
        <Select
          label={t("interview.route")}
          value={routeId}
          onChange={changeRoute}
          options={PRACTICE_ROUTES.map((c) => ({ value: c.route.id, label: routeTitle(c.country, localized(c.route, locale).name) }))}
        />
      ) : choice ? (
        <p className={styles.route}>
          <span className={styles.label}>{t("interview.route")}: </span>
          {routeTitle(choice.country, localized(choice.route, locale).name)}
        </p>
      ) : null}

      <Section title={t("interview.topics")} id="interview-topics">
        {!route ? (
          <Skeleton lines={4} label={t("common.loading")} />
        ) : (
          <>
            {route.status === "draft" ? (
              <div>
                <Badge kind="draft" long />
              </div>
            ) : null}
            <ul className={styles.topics} lang={topicLang} data-testid="interview-topics">
              {shownTopics.map((topic, i) => (
                <li key={i}>{topic}</li>
              ))}
            </ul>
            <p className={styles.note}>{t("interview.topics.help")}</p>
            <SourceList sources={route.sources} checked={route.last_verified} />
          </>
        )}
      </Section>

      {!ai.enabled ? (
        <Notice kind="info">
          <p>{t("interview.off")}</p>
        </Notice>
      ) : (
        <Section title={phase === "card" ? t("interview.card") : undefined} id="interview-practice">
          {lines.length || busy ? <ChatLog lines={lines} you={t("assistant.you")} other={t("interview.coach")} busy={busy ? t("interview.thinking") : null} /> : null}

          {problem ? (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          ) : null}

          {phase === "ready" && route ? (
            <>
              <div className={styles.row}>
                <Button icon={<IconMicrophone size={22} />} onClick={() => void startVoice()} full={false} data-testid="practice-voice">
                  {t("interview.voice")}
                </Button>
                <Button variant="secondary" icon={<IconKeyboard size={22} />} onClick={startText} full={false} data-testid="practice-text">
                  {t("interview.text")}
                </Button>
              </div>
              <p className={styles.note}>{t("assistant.freeTier")}</p>
            </>
          ) : null}

          {phase === "voice" ? (
            talk.state === "on" ? (
              <p className={styles.listening} role="status">
                <IconWaveform weight="bold" size={24} className={styles.wave} />
                {t("interview.listening")}
              </p>
            ) : (
              <p className={styles.note} role="status">
                {t("assistant.voice.connecting")}
              </p>
            )
          ) : null}

          {phase === "text" ? (
            <form className={styles.form} onSubmit={sendAnswer}>
              <TextArea label={t("interview.answer")} value={answer} onChange={setAnswer} rows={3} maxLength={2000} lang={language} />
              <div className={styles.row}>
                <Button type="submit" busy={busy} disabled={!answer.trim() || !transcript.length} icon={<IconPaperPlaneTilt size={22} />} full={false} data-testid="practice-answer">
                  {t("interview.send")}
                </Button>
              </div>
            </form>
          ) : null}

          {practising ? (
            <Button variant="danger" full={false} icon={<IconStop weight="fill" size={22} />} onClick={() => void end()} disabled={talk.state === "connecting"} data-testid="practice-end">
              {t("interview.end")}
            </Button>
          ) : null}

          {phase === "scoring" ? (
            <p className={styles.waiting} role="status">
              {t("interview.scoring")}
            </p>
          ) : null}

          {phase === "card" ? (
            <div className={styles.card} data-testid="interview-card">
              <p className={styles.note}>{t("interview.card.label")}</p>
              {card ? (
                <>
                  <ul className={styles.scores}>
                    {card.topics.map((row, i) => (
                      <li key={i} className={styles.score}>
                        <h3 lang={topicLang}>{shownTopics[i] ?? row.topic}</h3>
                        <Chip tone={ANSWERED_TONE[row.answered]}>{t(`interview.answered.${row.answered}`)}</Chip>
                        {row.tip ? <p dir="auto">{row.tip}</p> : null}
                      </li>
                    ))}
                  </ul>
                  {card.overall ? (
                    <p className={styles.overall} dir="auto">
                      {card.overall}
                    </p>
                  ) : null}
                </>
              ) : (
                <Notice kind="warning">
                  <p>{t("interview.cardFailed")}</p>
                </Notice>
              )}
              <Button variant="secondary" full={false} icon={<IconChalkboardTeacher size={22} />} onClick={again} data-testid="practice-again">
                {t("interview.again")}
              </Button>
            </div>
          ) : null}
        </Section>
      )}
    </Screen>
  );
}
