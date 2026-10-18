"use client";

import { useState, type ReactNode } from "react";
import {
  IconBank,
  IconBriefcase,
  IconClock,
  IconCompass,
  IconFileMagnifyingGlass,
  IconFiles,
  IconGraduationCap,
  IconHandCoins,
  IconIdentificationBadge,
  IconMapPin,
  IconPassport,
} from "@/components/icons";
import * as Icons from "@/components/icons/generated";
import { PageHead, Screen, StickyActions } from "@/components/shell/Screen";
import { BoardingPass } from "@/components/ui/BoardingPass";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Badge, StatusChip, StatusIcon, WhoChip } from "@/components/ui/Chips";
import { ChoiceGroup, ChoiceTile, LinkTile } from "@/components/ui/ChoiceTile";
import { CodeBox } from "@/components/ui/CodeBox";
import { Fact, FactList, NotYet, NumberedSteps, TickList } from "@/components/ui/Facts";
import { Select, TextArea, TextInput } from "@/components/ui/Field";
import { Flag } from "@/components/ui/Flag";
import { GoogleMark } from "@/components/ui/GoogleMark";
import { JourneyStrip } from "@/components/ui/JourneyStrip";
import { ListenButton } from "@/components/ui/ListenButton";
import { MoneyInput, type MoneyValue } from "@/components/ui/MoneyInput";
import { AiLine, ErrorNotice, Notice } from "@/components/ui/Notice";
import { Panel } from "@/components/ui/Panel";
import { PaperPicker } from "@/components/ui/PaperPicker";
import { PassportPage } from "@/components/ui/PassportPage";
import { PassportStatus } from "@/components/ui/PassportStatus";
import { ProgressMeter, StageDots } from "@/components/ui/ProgressMeter";
import { RecruiterStatusChip } from "@/components/ui/RecruiterStatus";
import { RunSteps } from "@/components/ui/RunSteps";
import { ConfirmDialog, Term, TermList } from "@/components/ui/Sheet";
import { Skeleton } from "@/components/ui/Skeleton";
import { SourceList, WebAddress } from "@/components/ui/SourceChip";
import { Stamp } from "@/components/ui/Stamp";
import { MenuList, MenuRow, StepList, StepRow } from "@/components/ui/StepRow";
import { SeverityChip, VerdictChip } from "@/components/ui/Verdict";
import { VoiceNote } from "@/components/ui/VoiceNote";
import type { PassportCheck } from "@/lib/engine/readiness";
import type { PaperFile } from "@/lib/files";
import { useI18n } from "@/lib/i18n";
import { formatStampDate } from "@/lib/i18n";
import styles from "./Styleguide.module.css";

// Sample content for the specimens. All of it is fictional and none of it is used by real screens.
const SAMPLE = {
  en: {
    route: "Work visa (sample)",
    stepTitle: "Check your offer letter",
    doc1: "Passport",
    doc2: "Police character certificate",
    doc3: "Medical test",
    name: "Your full name, as on your passport",
    nameHint: "Write it exactly as it is printed.",
    nameError: "The name is empty. Type your name or tap Speak.",
    promised: "What did the agent promise you?",
    promisedPh: "Example: driver job, 1,800 SAR a month, free room and food.",
    where: "Where do you apply?",
    source: "Sample official source",
    shareCode: "Family share code",
    confirmTitle: "Delete everything?",
    confirmBody: "This removes your journey, checks and cases from this phone and from your account. It cannot be undone.",
    confirmYes: "Delete everything",
    termLine: "Your university sends you a",
    termLineEnd: "after it accepts you.",
    warn: "This step is a draft. Check the official page before you pay.",
    saved: "Your step is saved.",
    info: "You can change your answers at any time.",
    listenText: "Check your offer letter before you pay.",
    issuer: "Sample passport office",
    bring: ["Your identity card", "Two photos", "The fee receipt"],
    steps: ["Fill in the form.", "Pay the fee at the bank.", "Give your fingerprints at the office."],
    time: "About 10 working days",
    panelTitle: "Sample office",
    panelBody: "A block that belongs together: a name, one line about it, and its one button.",
    termText: "Your university sends your CAS. Then you give biometrics.",
  },
  ur: {
    route: "ورک ویزا (نمونہ)",
    stepTitle: "اپنا آفر لیٹر چیک کریں",
    doc1: "پاسپورٹ",
    doc2: "پولیس کریکٹر سرٹیفکیٹ",
    doc3: "میڈیکل ٹیسٹ",
    name: "آپ کا پورا نام، جیسا پاسپورٹ پر ہے",
    nameHint: "بالکل ویسا لکھیں جیسا چھپا ہوا ہے۔",
    nameError: "نام خالی ہے۔ اپنا نام لکھیں یا «بولیں» دبائیں۔",
    promised: "ایجنٹ نے آپ سے کیا وعدہ کیا؟",
    promisedPh: "مثال: ڈرائیور کی نوکری، 1,800 SAR ماہانہ، رہائش اور کھانا مفت۔",
    where: "درخواست کہاں دیں؟",
    source: "نمونہ سرکاری ذریعہ",
    shareCode: "گھر والوں کے لیے شیئر کوڈ",
    confirmTitle: "سب کچھ مٹا دیں؟",
    confirmBody: "اس سے آپ کا سفر، جانچ اور کیس اس فون اور آپ کے اکاؤنٹ دونوں سے مٹ جائیں گے۔ یہ واپس نہیں ہو سکتا۔",
    confirmYes: "سب کچھ مٹا دیں",
    termLine: "یونیورسٹی داخلہ دینے کے بعد آپ کو",
    termLineEnd: "بھیجتی ہے۔",
    warn: "یہ قدم مسودہ ہے۔ پیسے دینے سے پہلے سرکاری صفحہ دیکھ لیں۔",
    saved: "آپ کا قدم محفوظ ہو گیا۔",
    info: "آپ اپنے جواب کسی بھی وقت بدل سکتے ہیں۔",
    listenText: "پیسے دینے سے پہلے اپنا آفر لیٹر چیک کریں۔",
    issuer: "نمونہ پاسپورٹ دفتر",
    bring: ["آپ کا شناختی کارڈ", "دو تصویریں", "فیس کی رسید"],
    steps: ["فارم بھریں۔", "بینک میں فیس جمع کروائیں۔", "دفتر میں انگلیوں کے نشان دیں۔"],
    time: "تقریباً 10 دفتری دن",
    panelTitle: "نمونہ دفتر",
    panelBody: "ایک ساتھ رہنے والی چیزیں: نام، اس کے بارے میں ایک سطر، اور اس کا ایک بٹن۔",
    termText: "یونیورسٹی آپ کو CAS بھیجتی ہے۔ پھر آپ بائیومیٹرکس دیتے ہیں۔",
  },
} as const;

const TOKENS = ["paper", "sheet", "ink", "ink-soft", "rule", "rule-strong", "green", "green-tint", "red", "red-tint", "amber", "amber-ink", "amber-tint", "ok", "ok-tint", "focus"];

/** Shows one specimen twice: on a light panel and on a dark panel. */
function Specimen({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className={styles.specimen}>
      <h2 className={styles.specimenTitle} lang="en" dir="ltr">
        {title}
      </h2>
      {note ? (
        <p className={styles.note} lang="en" dir="ltr">
          {note}
        </p>
      ) : null}
      <div className={styles.panels}>
        <div className={styles.panel} data-theme="light">
          {children}
        </div>
        <div className={styles.panel} data-theme="dark">
          {children}
        </div>
      </div>
    </section>
  );
}

function StampDemo() {
  const { t } = useI18n();
  const [run, setRun] = useState(0);
  return (
    <>
      <div className={styles.docCard}>
        <div className={styles.docText}>
          <strong>{t("doc.type.offer_letter")}</strong>
          <span className="soft small">1,200 SAR</span>
        </div>
        <Stamp key={run} level="red" word={t("stamp.red")} line={t("stamp.red.line")} label={`${t("stamp.red")}. ${t("stamp.red.line")}`} press={run > 0} seed="demo-red" />
      </div>
      <Button variant="secondary" compact full={false} onClick={() => setRun((n) => n + 1)}>
        <span lang="en">Replay the press</span>
      </Button>
      <div className={styles.rowWrap}>
        <Stamp level="amber" word={t("stamp.amber")} line={t("stamp.amber.line")} label={`${t("stamp.amber")}. ${t("stamp.amber.line")}`} seed="demo-amber" />
        <Stamp level="green" word={t("stamp.green")} line={t("stamp.green.line")} label={`${t("stamp.green")}. ${t("stamp.green.line")}`} seed="demo-green" />
        <Stamp level="done" word={t("stamp.done")} line={formatStampDate("2026-10-13")} label={t("stamp.done")} seed="stage-before" />
        <Stamp level="red" size="sm" word={t("stamp.red")} label={t("stamp.red")} seed="demo-small" />
      </div>
    </>
  );
}

export function Styleguide() {
  const { t, locale } = useI18n();
  const s = SAMPLE[locale === "ur" ? "ur" : "en"];
  const [why, setWhy] = useState("work");
  const [text, setText] = useState("");
  const [area, setArea] = useState("");
  const [where, setWhere] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [country, setCountry] = useState("PK");
  const [status, setStatus] = useState("doing");
  const [ticked, setTicked] = useState(true);
  const [money, setMoney] = useState<MoneyValue>({ amount: "450,000", currency: "PKR" });
  const [papers, setPapers] = useState<PaperFile[]>([]);
  const source = [{ title: s.source, url: "https://example.org/" }];
  const rule = { months: 6, title: "Valid passport", sources: source, status: "draft" as const };
  const passports: PassportCheck[] = [
    { status: "no-rule", expiry: "2027-03-13", monthsLeft: 5, rule: null, renewBy: null },
    { status: "short", expiry: "2027-01-20", monthsLeft: 3, rule, renewBy: "2026-07-20" },
    { status: "expired", expiry: "2026-08-01", monthsLeft: -2, rule: null, renewBy: null },
  ];

  return (
    <Screen tab="more" back={{ href: "/more" }}>
      <PageHead title="Styleguide" lead="Every component, on light and dark. Switch language with the links below to see right-to-left." />
      <p className={styles.links} lang="en" dir="ltr">
        <a href="/en/styleguide/">English</a>
        <a href="/ur/styleguide/">Urdu</a>
      </p>

      <Specimen title="Colour tokens">
        <ul className={styles.swatches}>
          {TOKENS.map((name) => (
            <li key={name} className={styles.swatch}>
              <span className={styles.chipColour} style={{ background: `var(--${name})` }} />
              <code lang="en" dir="ltr">
                --{name}
              </code>
            </li>
          ))}
        </ul>
      </Specimen>

      <Specimen title="Type scale" note="36 / 28 / 22 / 18 / 15. Nastaliq runs 1.1× with line height 2.">
        <p style={{ fontSize: "var(--fs-display)", fontWeight: "var(--w-title)", lineHeight: "var(--lh-title)" }}>{t("stamp.red.line")}</p>
        <h1>{t("journey.title")}</h1>
        <h2>{t("home.nextStep")}</h2>
        <p>{t("home.start.lead")}</p>
        <p className="small soft">{t("legal.info")}</p>
      </Specimen>

      <Specimen title="Buttons" note="One primary per screen. 56px tall. Labels say what happens.">
        <Button>{t("home.doNow")}</Button>
        <Button variant="secondary" full>
          {t("signin.guest")}
        </Button>
        <div className={styles.rowWrap}>
          <Button variant="quiet">{t("journey.change")}</Button>
          <Button variant="secondary" compact full={false} icon={<IconFiles size={22} />}>
            {t("docs.title")}
          </Button>
        </div>
        <Button variant="danger">{s.confirmYes}</Button>
        <Button disabled>{t("common.next")}</Button>
        <Button icon={<GoogleMark />}>{t("signin.google")}</Button>
      </Specimen>

      <Specimen title="Picture tiles" note="Onboarding answers. The whole tile is the tap target; the ring is empty until chosen.">
        <ChoiceGroup legend={t("start.why.title")}>
          <ChoiceTile value="work" checked={why === "work"} onChange={setWhy} picture={<IconBriefcase weight="duotone" size={44} />} title={t("start.why.work")} description={t("start.why.work.d")} />
          <ChoiceTile value="study" checked={why === "study"} onChange={setWhy} picture={<IconGraduationCap weight="duotone" size={44} />} title={t("start.why.study")} description={t("start.why.study.d")} />
          <ChoiceTile value="explore" checked={why === "explore"} onChange={setWhy} picture={<IconCompass weight="duotone" size={44} />} title={t("start.why.explore")} description={t("start.why.explore.d")} />
        </ChoiceGroup>
        <LinkTile href="/styleguide" picture={<IconFileMagnifyingGlass weight="fill" size={32} />} title={t("home.q.check")} description={t("home.q.check.d")} />
      </Specimen>

      <Specimen title="Country choices" note="The one place a flag appears: as the picture on a country choice, beside its name.">
        <ChoiceGroup legend={t("start.from.title")}>
          <ChoiceTile value="PK" checked={country === "PK"} onChange={setCountry} picture={<Flag code="PK" />} title={t("country.PK")} />
          <ChoiceTile value="SA" checked={country === "SA"} onChange={setCountry} picture={<Flag code="SA" />} title={t("country.SA")} />
          <ChoiceTile value="GB" checked={country === "GB"} onChange={setCountry} picture={<Flag code="GB" />} title={t("country.GB")} />
        </ChoiceGroup>
      </Specimen>

      <Specimen title="Dense choices" note="Short answers, two to a row: a step's status. The current one is in colour, the others grey.">
        <ChoiceGroup legend={t("item.status")} dense>
          {(["todo", "doing", "done", "skipped"] as const).map((value) => (
            <ChoiceTile key={value} value={value} checked={status === value} onChange={setStatus} picture={<StatusIcon status={value} size={28} muted={status !== value} />} title={t(`status.${value}`)} />
          ))}
        </ChoiceGroup>
      </Specimen>

      <Specimen title="Status, who and trust labels" note="Each status has its own shape. Draft is dashed; verified is solid and dated.">
        <div className={styles.rowWrap}>
          <StatusChip status="todo" />
          <StatusChip status="doing" />
          <StatusChip status="done" />
          <StatusChip status="skipped" />
          <StatusChip status="problem" />
        </div>
        <div className={styles.rowWrap}>
          <WhoChip who="you" />
          <WhoChip who="employer" />
          <WhoChip who="university" />
          <WhoChip who="government" />
          <WhoChip who="recruiter" />
        </div>
        <div className={styles.rowWrap}>
          <Badge kind="draft" />
          <Badge kind="verified" date="2026-10-12" />
          <Badge kind="sample" />
          <Badge kind="machine" />
          <Badge kind="aiTranslation" />
          <Badge kind="practice" />
        </div>
        <Badge kind="draft" long />
      </Specimen>

      <Specimen title="Source chips" note="Every rule, fee and helpline shows where it comes from and when it was last checked.">
        <SourceList sources={source} checked="2026-10-12" />
        <SourceList sources={source} />
        <WebAddress url="https://www.example.org/visas" />
      </Specimen>

      <Specimen title="Facts" note="A document guide's facts. A fact the team has not added says so in its place; it is never left blank.">
        <FactList>
          <Fact icon={<IconBank size={24} />} label={t("docs.issuedBy")}>
            {s.issuer}
          </Fact>
          <Fact icon={<IconMapPin size={24} />} label={t("docs.where")}>
            <NotYet />
          </Fact>
          <Fact icon={<IconClock size={24} />} label={t("docs.time")}>
            {s.time}
          </Fact>
        </FactList>
        <h3>{t("docs.bring")}</h3>
        <TickList items={[...s.bring]} />
        <h3>{t("docs.steps")}</h3>
        <NumberedSteps steps={[...s.steps]} />
      </Specimen>

      <Specimen title="Panel" note="A plain sheet for one block: a prompt with its button, a contact.">
        <Panel title={s.panelTitle}>
          <p>{s.panelBody}</p>
          <Button variant="secondary" compact full={false}>
            {t("sos.website")}
          </Button>
        </Panel>
      </Specimen>

      <Specimen title="Notices" note="Errors say what happened and what to do next.">
        <Notice kind="info">
          <p>{s.info}</p>
        </Notice>
        <Notice kind="warning">
          <p>{s.warn}</p>
        </Notice>
        <ErrorNotice kind="save" onRetry={() => undefined} />
        <Notice kind="success">
          <p>{s.saved}</p>
        </Notice>
        <AiLine />
      </Specimen>

      <Specimen title="Fields" note="Label above, 56px tall. Speak sits beside free-text inputs when the phone supports speech input.">
        <TextInput label={s.name} hint={s.nameHint} value={text} onChange={setText} />
        <TextInput label={s.name} value="" onChange={() => undefined} error={s.nameError} mic={false} />
        <TextArea label={s.promised} placeholder={s.promisedPh} value={area} onChange={setArea} optional />
        <Select
          label={s.where}
          value={where}
          onChange={setWhere}
          placeholder={t("common.unknown")}
          options={[
            { value: "online", label: t("docs.where.online") },
            { value: "office", label: t("docs.where.office") },
          ]}
        />
        <TextInput label={t("check.phone")} value="+92 300 0000000" onChange={() => undefined} ltr mic={false} type="tel" />
      </Specimen>

      <Specimen title="Ticks and money" note="A tick box is a 56px row. An amount and its currency sit side by side; the amount is typed in Western digits.">
        <Checkbox checked={ticked} onChange={setTicked} label={t("check.cashOnly")} hint={t("check.share")} />
        <MoneyInput label={t("cost.ask")} hint={t("cost.ask.help")} value={money} onChange={setMoney} />
      </Specimen>

      <Specimen title="Papers and voice" note="Camera or files, each paper with its own Remove. The voice note shows its time and a Play button once recorded.">
        <PaperPicker papers={papers} onChange={setPapers} />
        <VoiceNote onChange={() => undefined} />
      </Specimen>

      <Specimen title="Working steps" note="What the check is doing, in plain words. The current step breathes; done steps get a tick.">
        <RunSteps
          steps={[
            { id: "read", label: t("run.read"), state: "done" },
            { id: "agent", label: t("run.agent"), state: "doing" },
            { id: "rules", label: t("run.rules"), state: "todo" },
          ]}
        />
      </Specimen>

      <Specimen title="Verdict and severity chips" note="Past checks and flags. Each level keeps the stamp's own shape.">
        <div className={styles.rowWrap}>
          <VerdictChip level="red" />
          <VerdictChip level="amber" />
          <VerdictChip level="green" />
        </div>
        <div className={styles.rowWrap}>
          <SeverityChip severity="high" />
          <SeverityChip severity="medium" />
          <SeverityChip severity="low" />
        </div>
        <div className={styles.rowWrap}>
          <RecruiterStatusChip status="active" />
          <RecruiterStatusChip status="suspended" />
          <RecruiterStatusChip status="cancelled" />
        </div>
      </Specimen>

      <Specimen title="Passport dates" note="Valid until, months left, and what to do. Without a rule in the pack, it says so and points to the official site.">
        {passports.map((check) => (
          <PassportStatus key={check.status} check={check} route={s.route} today="2026-10-13" sources={source} level={3} calendar={false} />
        ))}
      </Specimen>

      <Specimen title="Listen" note="Shown only when the phone has a voice for the language, so there is never a dead button.">
        <ListenButton text={s.listenText} />
        <p className="small soft" lang="en" dir="ltr">
          Nothing above this line means this browser has no voice for this language.
        </p>
      </Specimen>

      <Specimen title="The stamp" note="Octagon and hand for stop, scooped rectangle and triangle for check, pill and tick for looks OK, round date stamp for a finished stage.">
        <StampDemo />
      </Specimen>

      <Specimen title="Passport page" note="One journey stage. The DONE stamp lands in the corner when every step is finished.">
        <PassportPage page={1} title={t("journey.stage.before")} done={3} total={3} stamp={<Stamp level="done" size="sm" word={t("stamp.done")} line={formatStampDate("2026-10-13")} label={t("stamp.done.label", { stage: t("journey.stage.before"), date: "13 Oct 2026" })} seed="stage-before" />}>
          <StepList>
            <StepRow href="/styleguide" status="done" title={t("app.checkOffer")} meta={<WhoChip who="you" />} />
            <StepRow href="/styleguide" status="done" title={t("app.checkAgent")} meta={<WhoChip who="you" />} />
            <StepRow href="/styleguide" status="done" title={t("app.cost")} meta={<WhoChip who="you" />} />
          </StepList>
        </PassportPage>
        <PassportPage page={2} title={t("journey.stage.documents")} done={0} total={3}>
          <StepList>
            <StepRow
              href="/styleguide"
              status="doing"
              title={s.doc1}
              meta={
                <>
                  <WhoChip who="you" />
                  <Badge kind="draft" />
                </>
              }
            />
            <StepRow href="/styleguide" status="todo" title={s.doc2} meta={<WhoChip who="government" />} />
            <StepRow href="/styleguide" status="problem" title={s.doc3} meta={<WhoChip who="you" />} />
          </StepList>
        </PassportPage>
      </Specimen>

      <Specimen title="Boarding pass" note="Home's next-step card: from, to, tear line, the step, one button.">
        <BoardingPass
          from={t("country.PK")}
          to={t("country.SA")}
          route={s.route}
          kicker={t("home.nextStep")}
          title={s.stepTitle}
          meta={
            <>
              <WhoChip who="you" />
              <span>{t("home.stepOf", { n: 1, total: 14 })}</span>
            </>
          }
          action={<Button>{t("home.doNow")}</Button>}
        />
      </Specimen>

      <Specimen title="Progress" note="One bar, one sentence, and the reasons behind the number.">
        <ProgressMeter
          value={21}
          label={t("journey.score")}
          summary={t("home.doneCount", { done: 3, total: 14 })}
          whyLabel={t("journey.score.why")}
          reasons={[t("journey.score.done", { done: 3, total: 14 }), t("journey.score.waiting", { n: 4 }), t("journey.score.draft", { n: 11 })]}
        />
        <StageDots
          stages={[
            { id: "a", label: t("journey.stage.before"), status: "done" },
            { id: "b", label: t("journey.stage.documents"), status: "doing" },
            { id: "c", label: t("journey.stage.visa"), status: "todo" },
            { id: "d", label: t("journey.stage.departure"), status: "todo" },
            { id: "e", label: t("journey.stage.arrival"), status: "todo" },
          ]}
        />
        <JourneyStrip
          href="/styleguide"
          summary={t("home.doneCount", { done: 3, total: 14 })}
          action={t("home.seeAll")}
          stages={[
            { id: "a", label: t("journey.stage.before"), status: "done" },
            { id: "b", label: t("journey.stage.documents"), status: "doing" },
            { id: "c", label: t("journey.stage.visa"), status: "todo" },
          ]}
        />
      </Specimen>

      <Specimen title="Menu rows">
        <MenuList>
          <MenuRow href="/styleguide" icon={<IconPassport size={26} />} title={t("home.q.docs")} description={t("home.q.docs.d")} />
          <MenuRow href="/styleguide" icon={<IconIdentificationBadge size={26} />} title={t("home.q.agent")} description={t("home.q.agent.d")} />
          <MenuRow href="/styleguide" icon={<IconHandCoins size={26} />} title={t("home.q.cost")} description={t("home.q.cost.d")} />
        </MenuList>
      </Specimen>

      <Specimen title="Codes" note="The only place the mono face is used. Always left to right.">
        <CodeBox label={s.shareCode} code="K7QF2MPX9TRD4H" />
      </Specimen>

      <Specimen title="Terms and dialogs" note="A word is explained the first time it appears. Anything that cannot be undone asks first.">
        <p>
          {s.termLine} <Term id="cas" /> {s.termLineEnd}
        </p>
        <p>{s.termText}</p>
        <TermList text={s.termText} />
        <Button variant="secondary" full onClick={() => setConfirm(true)}>
          {s.confirmYes}
        </Button>
      </Specimen>

      <Specimen title="Skeleton" note="Loading content shows its shape. No spinners.">
        <Skeleton block lines={3} label={t("common.loading")} />
      </Specimen>

      <Specimen title="Icons" note="Phosphor, one set. Generated from scripts/icons.config.mjs.">
        <ul className={styles.icons}>
          {Object.entries(Icons).map(([name, Icon]) => (
            <li key={name} title={name}>
              <Icon size={28} />
            </li>
          ))}
        </ul>
        <div className={styles.rowWrap}>
          <StatusIcon status="todo" />
          <StatusIcon status="doing" />
          <StatusIcon status="done" />
          <StatusIcon status="skipped" />
          <StatusIcon status="problem" />
        </div>
      </Specimen>

      <StickyActions>
        <Button href="/home">{t("common.home")}</Button>
      </StickyActions>

      <ConfirmDialog open={confirm} title={s.confirmTitle} body={<p>{s.confirmBody}</p>} confirmLabel={s.confirmYes} danger onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)} />
    </Screen>
  );
}
