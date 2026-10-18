"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { IconCoins, IconFileMagnifyingGlass, IconIdentificationBadge, IconListChecks, IconMicrophone, IconPaperPlaneTilt, IconSiren, IconStop, IconWaveform } from "@/components/icons";
import { PageHead, Screen } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { ChatLog, type ChatLine } from "@/components/ui/ChatLog";
import { TextArea } from "@/components/ui/Field";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { AiLine, Notice } from "@/components/ui/Notice";
import { MenuList, MenuRow } from "@/components/ui/StepRow";
import type { ChatTurn } from "@/lib/ai";
import { aiProvider } from "@/lib/ai-firebase";
import { assistantSystem, assistantTurn } from "@/lib/assistant";
import { ASSISTANT_TOOLS, TOOL_KEYS, type ToolDeps } from "@/lib/assistant-tools";
import { useJourney } from "@/lib/data";
import { formatList, useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import type { LiveFailure } from "@/lib/live";
import { loadPack } from "@/lib/packs";
import { PROMPTS } from "@/lib/prompts";
import { recruiterDirectory } from "@/lib/recruiter-list";
import { useLiveTalk, type Talked } from "@/lib/use-live-talk";
import styles from "./Assistant.module.css";

const TOOL_DEPS: ToolDeps = { directory: recruiterDirectory, loadPack };

/** Ask Pardes Guard: questions answered from the app's own data, by typing or by talking. */
export function AssistantScreen() {
  const { t, locale } = useI18n();
  const journey = useJourney();
  const ai = aiProvider();
  const language = journey.settings.ai_language ?? locale;

  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const toolNote = (names: string[] | undefined) => (names?.length ? t("assistant.used", { list: formatList(locale, [...new Set(names)].map((n) => t((TOOL_KEYS[n] ?? "assistant.tool.route") as Key))) }) : undefined);
  const spokenLines = (talked: Pick<Talked, "lines" | "tools" | "links">) =>
    talked.lines.map((l, i): ChatLine => ({ who: l.who === "you" ? "you" : "other", text: l.text, note: toolNote(talked.tools[i]), links: talked.links[i] }));

  // What was said aloud stays on screen, and goes into the history so typed questions can follow on.
  const talk = useLiveTalk((talked) => {
    setLines((l) => [...l, ...spokenLines(talked)]);
    setHistory((h) => [...h, ...talked.lines.map((l): ChatTurn => ({ role: l.who === "you" ? "user" : "model", parts: [{ text: l.text }] }))]);
    if (talked.endedByService) setProblem(t("live.ended"));
  });

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText("");
    setProblem(null);
    setLines((l) => [...l, { who: "you", text: message }]);
    setBusy(true);
    const abort = new AbortController();
    controller.current = abort;
    const out = await assistantTurn(history, message, { ai, prompts: PROMPTS, tools: TOOL_DEPS, language, signal: abort.signal });
    if (abort.signal.aborted) return;
    setBusy(false);
    if (out.ok) {
      setHistory(out.history);
      setLines((l) => [...l, { who: "other", text: out.reply, note: toolNote(out.toolsUsed), links: out.links }]);
    } else {
      setProblem(t(`assistant.fail.${out.reason}` as Key));
    }
  };

  const toggleTalk = async () => {
    if (talk.state === "on") return talk.stop();
    setProblem(null);
    const failed = await talk.start({ system: assistantSystem(PROMPTS, language), tools: ASSISTANT_TOOLS, toolDeps: TOOL_DEPS });
    if (failed) setProblem(t(`live.fail.${failed satisfies LiveFailure}` as Key));
  };

  const reset = async () => {
    controller.current?.abort();
    controller.current = null;
    if (talk.state !== "off") await talk.stop();
    setBusy(false);
    setHistory([]);
    setLines([]);
    setProblem(null);
  };

  const shown = talk.lines.length ? [...lines, ...spokenLines(talk)] : lines;
  const talking = talk.state !== "off";

  return (
    <Screen tab="help" back={{ href: "/help", label: t("help.title") }}>
      <PageHead title={t("assistant.title")} lead={t("assistant.lead")} />
      <p className={styles.danger}>
        <IconSiren weight="fill" size={20} />
        <LocaleLink href="/sos">{t("assistant.danger")}</LocaleLink>
      </p>

      {!ai.enabled ? (
        <>
          <Notice kind="info">
            <p>{t("assistant.off")}</p>
          </Notice>
          <MenuList>
            <MenuRow href="/check" icon={<IconFileMagnifyingGlass weight="fill" size={26} />} title={t("home.q.check")} description={t("home.q.check.d")} />
            <MenuRow href="/recruiters" icon={<IconIdentificationBadge weight="duotone" size={26} />} title={t("home.q.agent")} description={t("home.q.agent.d")} />
            <MenuRow href="/eligibility" icon={<IconListChecks weight="duotone" size={26} />} title={t("elig.title")} description={t("app.eligibility.d")} />
            <MenuRow href="/wage" icon={<IconCoins weight="duotone" size={26} />} title={t("cases.wage")} description={t("cases.wage.d")} />
          </MenuList>
        </>
      ) : (
        <>
          {shown.length || busy ? <ChatLog lines={shown} you={t("assistant.you")} other={t("assistant.bot")} busy={busy ? t("assistant.thinking") : null} /> : null}
          {shown.some((l) => l.who === "other") ? <AiLine text={t("assistant.ai")} /> : null}
          {problem ? (
            <p className={styles.problem} role="alert">
              {problem}
            </p>
          ) : null}

          {talk.state === "on" ? (
            <p className={styles.listening} role="status">
              <IconWaveform weight="bold" size={24} className={styles.wave} />
              {t("assistant.voice.on")}
            </p>
          ) : null}

          <form className={styles.form} onSubmit={(e) => void send(e)}>
            <TextArea label={t("assistant.input")} placeholder={t("assistant.placeholder")} value={text} onChange={setText} rows={3} maxLength={2000} lang={language} mic={!talking} />
            <div className={styles.row}>
              <Button type="submit" busy={busy} disabled={!text.trim() || talking} icon={<IconPaperPlaneTilt size={22} />} full={false} data-testid="ask">
                {t("assistant.send")}
              </Button>
              <Button
                variant={talking ? "danger" : "secondary"}
                full={false}
                onClick={() => void toggleTalk()}
                busy={talk.state === "connecting"}
                disabled={busy}
                icon={talking ? <IconStop weight="fill" size={22} /> : <IconMicrophone size={22} />}
                aria-pressed={talking}
                data-testid="talk"
              >
                {talk.state === "connecting" ? t("assistant.voice.connecting") : talk.state === "on" ? t("assistant.voice.stop") : t("assistant.voice")}
              </Button>
            </div>
          </form>
          {shown.length ? (
            <Button variant="quiet" full={false} onClick={() => void reset()}>
              {t("assistant.clear")}
            </Button>
          ) : null}
          <p className={styles.note}>{t("assistant.freeTier")}</p>
        </>
      )}
    </Screen>
  );
}
