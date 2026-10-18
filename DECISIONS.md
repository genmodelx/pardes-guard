# Decisions

Choices made while rebuilding Pardes Guard for the no-cost stack, with the reason for each. The team's
build brief said what to build (it is in the git history; see entry 115); this file records what was
decided where the brief left room. Newest phase last. If a decision turns out wrong, change it here first, then in the code.

## Phase 1 (13 October 2026)

### Structure

1. **Each language is a folder of static pages.** `/ur/home/`, `/en/home/`. The HTML a phone receives is
   already in the right language and direction before any script runs, and Urdu pages preload only the
   Urdu font. Done with two root layouts: `app/(welcome)` for the language picker at `/`, and
   `app/[locale]` for everything else, plus `app/global-not-found.tsx` for Firebase Hosting's `404.html`.
2. **Ids travel in the query string** (`/journey/item/?id=doc:passport`). A static export cannot have a
   page per id. Document guides are the exception: they are known at build time, so each one is a real
   static page (`/ur/documents/pk/passport/`) that works without JavaScript.
3. **The start questions keep their number in the address** (`/start/?q=2`), so the phone's Back button
   goes to the previous question instead of leaving the flow.
4. **Screens that later phases deliver had a stand-in** ("This part is being rebuilt") so no link in the
   app led nowhere while the build was in progress. Interview practice was the last one; Phase 3 removed
   the stand-in and its strings.

### Design

5. **Fonts are the Google Fonts families, served from our own `/fonts` folder** (copied from the
   `@fontsource-variable` packages by `npm run fonts`). Same files as fonts.googleapis.com, but no
   request to a second host, and it works offline. Each face has a `unicode-range`, so a page downloads
   only the script it shows.
6. **"Pardes Zero".** Atkinson Hyperlegible Next has only a slashed zero. On amounts such as 450,000 PKR
   that reads as a letter to people who are not used to it. A one-glyph font with a plain zero (from
   Onest, OFL) sits first in the font stacks. The mono face used for codes keeps its slashed zero, where
   telling 0 from O matters.
7. **Icons: Phosphor, generated.** `scripts/icons.config.mjs` lists the icons and weights in use and
   `npm run icons` writes them to one tree-shakeable file. One custom icon (a passport booklet with a
   plain ring where an emblem would be).
8. **Flags appear only as the picture on a country choice.** The brief rules out flags "used as
   authority". On the two country questions a flag is the fastest way for someone who reads little to
   find their country, so the tiles show one beside the name. Nowhere else. Files come from the
   `flag-icons` package (MIT) through `npm run flags`. (The first design draft said "never by flag";
   this replaces it.)
9. **The stamp.** Octagon for STOP, scooped rectangle for CHECK, pill for LOOKS OK, round date stamp for
   a finished stage. Icon above the word. The small second line is dropped in Arabic-script languages,
   where it could not be kept legible at stamp size. A stage stamp lands once, the first time its page
   is seen complete (remembered per device in `pg.stampsSeen`), then it is simply there.
10. **SOS sits in the top bar of every screen**, not in the bottom bar, so the four tabs keep their
    places and SOS is never one of several equal choices.
11. **Home lists the other actions as rows**, not a 2 by 2 grid of tiles. Rows fit Urdu labels on one
    line at 360px; the grid did not.
12. **The security-print pattern on Home is a strip under the top bar**, edge to edge. Squeezed between
    the brand and SOS at 360px it looked like a scribble.
13. **A journey page that is all draft says so once**, under its title, instead of on every row. Rows
    carry their own badge only when a page mixes draft and checked content.
14. **CSS Modules with logical properties only.** `tests/design.test.ts` fails on any `left`/`right`
    property and checks text contrast for both themes.
15. **Links prefetch only where it pays.** The bottom bar, SOS and a screen's primary button fetch their
    target ahead of the tap. Rows and secondary links do not: on a metered connection a screen should
    not download every page it links to. A thin bar across the top shows that a tapped screen is on its
    way.

### Words and languages

16. **Filipino is `fil` everywhere** (the old prompt file used `tl`).
17. **Dates are Gregorian with Western digits in every language.** A visa date must read the same in
    Urdu as on the visa. Amounts keep their currency code ("450,000 PKR").
18. **Pack text carries its own translations** (`i18n: { ur: { title: ... } }` beside the English), with
    a per-model list of fields that may be translated. Numbers, links and statuses cannot be translated
    by construction. A missing translation falls back to English and is marked `lang="en"` on screen.
19. **Words such as CAS and Protector are explained where they appear.** `lib/terms.ts` finds known terms
    in a step or guide, and the screen offers each meaning one tap away.

### Data

20. **The plan is built from the packs every time; the saved journey holds only answers and statuses by
    step id.** When the team verifies or corrects a pack, every person's journey updates without a
    migration. Changing the three answers keeps the ticks of steps that still exist.
21. **Progress score** = share of steps done or marked "not needed", capped at 40 while a check with a
    red stamp is open. The screen lists the reasons: steps done, steps waiting on someone else, the red
    cap, and how many steps are still draft.
22. **Document guides can live in any pack and are looked up origin first, then destination.** A passport
    means the person's own passport; a CAS comes from the destination.
23. **A checklist item can be limited to route purposes.** Pakistan's emigration steps (Protector,
    insurance, briefing) are for workers and are not shown to students.
24. **Links in packs must be https and on an official domain.** The pack loader rejects any URL whose
    host is not covered by some pack's `official_domains`. A fee needs an amount, a currency, a source
    and a last-verified date together, or no amount at all.
25. **Each country's pack is its own file** (`data/packs/PK.json`), so a phone downloads two countries,
    not ten. A small index (`data/pack-index.json`) has the names for the start questions.

### Accounts and storage

26. **Everyone starts as a guest.** Data lives on the phone (LocalStore) and nothing is asked. Signing in
    with Google moves the journey to the account (FirestoreStore). The Firebase SDK is downloaded only
    when someone taps "Continue with Google", or on later visits by someone who signed in before.
27. **A copy of the app built without Firebase config skips the sign-in screen** and runs fully on the
    device with no Gemini. This is also the shape the browser tests run against.
28. **One document per person: `journeys/{uid}`** holds the journey, settings, and the ids of that
    person's fraud signals and reports (which they can write and delete but not read back).
29. **Firestore rules follow the brief's table, plus:** a signed-in user may `get` a missing document in
    `checks`, `cases` and `evidence` (so "not found" differs from "not yours"); evidence can never be
    updated and must carry the server's time; staff may update reports and delete signals and reports;
    a share's `case_id` cannot change.

### AI

30. **`lib/ai.ts` holds the provider and no Firebase code; `lib/ai-firebase.ts` carries the request.**
    The fallback logic is tested with a stand-in transport.
31. **Model chain:** `gemini-3.8-flash`, then `gemini-3.5-flash-lite`, then `gemma-4-31b-it`, then no AI.
    A quota error rests that model (the delay Google sends, else one minute; six hours for a daily
    limit) and moves on. An unknown model or unsupported input also moves on. A blocked answer, a
    network failure or "AI not enabled" stops at once.
32. **Gemma gets its instruction and the JSON schema inside the prompt**, and its answer is parsed out of
    the text. No temperature or penalties are sent to any model: Gemini 3 ignores the first and rejects
    the second.
33. **Live transcripts:** `startAudioConversation` consumes `receive()` and drops the transcription
    messages, so the session's `receive` is wrapped before the helper starts (done in Phase 3, see 75).

### Tooling

34. **Playwright is pinned to 1.56.0**, the version whose Chromium is already installed in the build
    environment; `playwright-core` is pinned to match so the axe plugin shares it.
35. **The README keeps its old body until Phase 4**, with a status note on top, so nothing in it claims
    more than is built.

## Phase 2 (13 October 2026)

### Check

36. **Four fictional sample papers** (`npm run samples` draws them, with a SAMPLE band and watermark, into
    `public/samples/`, and writes `data/samples.json`): a fraudulent driver's contract, a clean one, one
    with hidden text aimed at AI checkers, and a UK admission letter. Each carries a prepared reading, so
    "Try a sample" works with the AI reader off. With it on, the picture goes to Gemini like any paper and
    the prepared reading is only the fallback. A sample check is saved with `source: "sample"` and never
    counts in the progress score, the red-check notice on Home or the journey's ticks.
37. **The order of a check is fixed in `lib/check-run.ts`:** read each paper, listen to the voice note or
    typed words, look up the agent, run the rules, explain, save. Gemini reads and explains; the verdict,
    the flags and the score come from `lib/engine`. A typed value always wins over one read from a voice
    note. An explanation that looks like an injection, or runs too long, is dropped.
38. **Flags carry the values they used** (`params`), which wording applies (`variant`, such as a borrowed
    licence) and who to confirm with (`verify`). The screen builds the sentence in the reader's language
    from these; the English sentence stays on the flag, and is shown (marked as English) when a stored
    check has no values.
39. **Two rules were added to both engines** (TypeScript and Python): `VISA_GUARANTEED` (medium) when a
    paper or the person's words promise a guaranteed visa, and `UNCLEAR_DOCUMENT` (medium) when the
    reader's confidence is below 0.3. An unreadable paper can no longer come out green.
40. **The borrowed-licence check compares only the distinctive part of two firm names.** "Sunrise
    Manpower Promoters" and "Northstar Employment Promoters" share their generic words, which made the
    fuzzy score look like a match. Both engines strip a list of generic words first.
41. **Hidden instructions are caught two ways:** the text screen, and Gemini listing any sentence aimed
    at an automated reader (`instructions_to_ai`). The result quotes what was found.
42. **A paper's translation is made only when asked for** (a button on the result), labelled "AI
    translation, not certified", and kept with the check. It never feeds the verdict.
43. **Voice notes are WAV, 16 kHz mono, at most two minutes,** encoded on the phone. Which compressed
    formats a phone records differs between makers; WAV is one Gemini accepts. Not yet sent to Gemini.
44. **With the AI reader off, the person types what the paper says**, and the rules still give a result.
    The same form appears when the reader is switched off in the project or fails on every paper.
45. **Reports and fraud signals need an account.** Reports go only to staff; signals are hashed on the
    phone and shared only when a signed-in person ticks the box, never for a sample.
46. **The sticky action bar never hides a focused field**: the page keeps scroll padding the height of
    the bar (WCAG 2.2, 2.4.11). Times are shown on a 24-hour clock, because "AM" and "PM" are Latin
    letters that jump around inside Urdu text.

### Cost

47. **A cost shows a number only with an amount, a currency, a source and a checked date.** No route in
    the packs has one yet, so every line says "Not checked yet", and comparing says plainly that the
    agent's part cannot be worked out. Pakistan's legal maximum fee is not in the pack either, so that
    section names the office to ask and links its site. The sums are done in whole cents. When some costs
    are unchecked, an ask above the maximum is "may be above", not "above".

### Readiness scan

48. **Only three things are read from a paper: its kind, the name and the expiry date.** Not the document
    number, not the date of birth (the prompt and the schema were cut down; prompt version
    2026-10-13.3). Photos are read one at a time and dropped once read. The person can correct every
    value, and only the readings are saved, in their own record. Staff may read that record under the
    brief's rules, which is one more reason to keep it this small.
49. **No route in the packs has a passport validity rule with a number**, so the scan shows the expiry
    date and months left, says the visa's rule is not added yet, and links the route's official sites.
    The journey's deadline is the expiry date until a rule exists; with a rule it becomes the last day to
    renew. A Google Calendar link opens a filled-in event the person saves themselves; it is not offered
    for sample papers.
50. **Names are compared only when both are in Latin letters**: same, same words in another order, or
    spelled differently. Papers with a name in another script are listed as not compared, instead of
    being reported as a mismatch.
51. **The readiness sample is readings only, with no pictures.** The app never draws an imitation
    passport, not even a marked one.

### Recruiters

52. **The bundled recruiter list is the fictional sample**, and every recruiter screen says so and points
    to the regulator's site from the Pakistan pack. Search works on name, licence number and city (city
    search was added to both engines). Looking up a fictional firm does not tick the journey's "check the
    agent" step; the person still has to check their real agent.
53. **Ratings are stars only, and only for signed-in users.** No free-text comments: they would be public,
    unmoderated text about named firms. A problem with an agent goes to "Report this agent", which only
    staff read.

### Shared pieces

54. **Small helpers instead of string tricks:** `rich()` puts a name or licence number into a translated
    sentence inside `<bdi>`, so it keeps its own direction in Urdu; `formatList()` joins a list the way
    the reader's language does (`Intl.ListFormat`). `AddPaperButtons`, `ReportSheet`, `PassportStatus` and
    `RecruiterStatusChip` are shared between screens.

## Phase 3 (13 October 2026)

### Cases

55. **A case is a ladder of letters, and the ladder moves when the app opens.** A static app has no
    server to wake it, so `advanceCases` runs each time the journey loads: a step whose waiting days have
    passed becomes "waiting for you", and Home says a letter is waiting. Nothing is sent by the timer.
    The waiting days come from the origin pack (`ladder_days`) where it has them.
56. **The app never sends a letter.** The person edits it, approves it, then sends it themselves with
    WhatsApp, email or a copy, and taps "I have sent it" with how (WhatsApp, email, by hand, by post,
    other). The case history records that they said so, not that it arrived.
57. **Every letter starts from a fixed template** with the case's own facts, so a letter exists with the
    AI off. With the AI on, "Write it with AI" drafts one in the AI language from the case facts only,
    passed as untrusted data; the draft is cut at 2,500 characters and shown for editing, never sent.
58. **An emergency case claims nothing.** It records "Emergency case opened" and offers a ready
    WhatsApp message the person sends to someone they trust, plus the help contacts. It does not say
    anyone was alerted, because nobody is.
59. **Evidence joins a case by reference.** A file from the vault is linked once (one "evidence added"
    event); the letter mentions the number of files only when there are some.

### Family

60. **A family code is 14 characters from a 31-letter alphabet** with no 0, O, 1, I or L (about 69 bits),
    drawn without bias. Anyone with the code can read the share (`get`, never `list`). The share holds
    only the case's title, kind, status and country, its steps (name, state, action) and the last
    update: no summary, no letters, no evidence. Stopping sharing deletes the share, so the old code
    stops working.
    In the build without Firebase the share is kept on the same phone, which is enough for the demo only.

### Vault and wage check

61. **Files stay on the phone; only their records sync.** The brief's stack has no file storage, so the
    bytes live in this browser's IndexedDB, and each record holds the file's SHA-256 fingerprint and the
    fingerprint of the record before it. Checking the chain names what is wrong (a file missing, a broken
    link, changed details or changed content). "Download everything" gives a ZIP with a `manifest.json`
    of the records. Up to 25 MB a file.
62. **The wage check is the engine's code with the dates people know**: the contract amount, the amount
    paid, the month, the pay day and the day it came. Short pay and late pay can open a case directly.

### Eligibility and privacy

63. **Eligibility says why for every requirement, and never "you are eligible".** Each answer is a code
    with its values (age 41, limit 39), turned into a sentence on screen, so it reads the same in every
    language. Months left on the passport come from the readiness scan when there is one.
64. **Delete everything goes in a fixed order:** shares, cases, checks, evidence, ratings, signals,
    reports, and the person's own record last (a failure part-way leaves the ids for another try), then
    the vault files, then the app's browser data, then the account. Language, theme and simple mode stay,
    so the phone does not jump to another language. If Google needs a fresh sign-in to delete the
    account, the screen says so.
65. **One setting chooses the AI's language** (explanations, letters, assistant, interview), separate
    from the interface language. It starts as the interface language. A Pashto speaker can use the
    English interface and get answers in Pashto.

### Assistant

66. **The assistant only reads.** Its five functions are the licensed list, a route's facts, the
    eligibility code, the wage check and the help contacts. None can save, send or change anything. At
    most four function rounds per question.
67. **Links shown under an answer come from the functions' answers, never from the model's text.** Each
    carries its checked date, or "not checked yet". A reply that reads like instructions to a machine,
    or runs past 4,000 characters, is not shown.
68. **Gemma is left out of the chat chain**: the fallback works for JSON reading, but function calls need
    a Gemini model. With both Gemini models resting, the assistant says it reached the free limit.
69. **Talking and typing share one conversation.** What was said aloud is kept on screen and joins the
    typed history, so a typed question can follow a spoken one.

### Interview practice

70. **The interviewer asks only about the route's own topics** from the pack. Only the UK student visa
    has topics so far, so the screen lists that route; anyone else is told their visa has none yet.
71. **Feedback is per topic: answered clearly, partly, or not yet, with one tip.** It is labelled
    practice from AI, never a score or a prediction. Feedback is matched to the topics by their words,
    then by their place, and text that reads like instructions is dropped.
72. **Practising the journey's own visa ticks its interview step**, whether or not the feedback could be
    written.
73. **When Google closes a voice session by itself** (it ends long ones), the practice ends there and the
    feedback is written from what was said.

### Live voice

74. **Model `gemini-3.1-flash-live-preview`, audio out, with both transcriptions on.** The language goes
    in the system instruction. The Firebase helper handles the microphone, playback and interruptions.
    It sends back one function answer per message, so when the model asks for several at once the app
    sends the others itself.
75. **The session's `receive()` is wrapped** to pass every transcription piece to the screen and to say
    when the stream ends, while the audio helper still gets every message unchanged.

### Languages

76. **Hindi, Bengali, Nepali and Filipino were drafted by the AI model that built this version, not by
    Gemini.** No Google host could be reached from the build machine. Each language has every string
    except the staff screens (admin, NGO, which stay English), checked by script for placeholders,
    digits (0-9 only) and links. They are labelled machine translation and need a native reviewer.
77. **On those languages every screen starts with one quiet line**: machine translation, it may have
    mistakes, and a link to the same screen in English (query included). The link does not change the
    saved language, so the next visit opens in the person's own language again.
78. **Choices made for the drafts:** a file's fingerprint is called a digital code or mark, never a
    finger word; a case is a complaint or matter, not a court case; education levels are the reader's
    own (SSC and HSC in Bengali, SEE and +2 in Nepali, high school and senior high in Filipino; Hindi
    keeps Matric and Intermediate beside 10th and 12th). Content from the packs stays English, marked `lang="en"`.
79. **Unused strings were removed before drafting** (103 keys left over from the first interface), so
    nothing is translated that no screen shows. A test now fails if a new string lacks a draft in any
    language outside the staff screens.

## Phase 4 (14 October 2026)

### Privacy

80. **Phone, account, card and ID numbers keep only their last four digits from the moment a case is
    opened.** The title and summary are masked before they are saved, so the letters, the family view
    and Gemini only see the masked text. Dates (2026-10-05) and amounts (450,000 PKR) are left alone,
    and a number counts as a phone number only with at least ten digits. Email addresses stay, because
    a letter may need to be answered at one. A case saved before this is masked again when a letter is
    built from it.

### Simple mode

81. **Simple mode is bigger text and fewer choices, kept in this browser like the theme.** It hides the
    AI language setting, eligibility, the documents row on Home, and the wage, vault, family and
    interview rows in Help. It hides; it does not remove: each of those screens still opens from its
    link. The boot script sets it before the first paint, so the page does not jump.

### NGO console and admin

82. **Staff are only the people named in `roles/{uid}`**, which no client can write. The screens ask the
    same document the rules check, so a hidden button is a convenience and the rules are the
    protection. Only an admin may replace the licensed list, in the rules (`config/recruiters` and its
    parts) as well as on screen; NGO staff can still publish warnings and confirm layouts.
83. **A guest can try the staff screens with sample data** ("Try the staff screens" in More, shown when
    simple mode is off). It only reads and writes this phone's own data, and it is not offered to a
    signed-in person, whose role comes from the server alone. The sample is five fictional signals and
    two reports, built so that three agencies share a phone number and a fee account.
84. **The review queue holds reports only.** The rules let staff read checks and cases (brief section
    4), but the console does not list them: a worker's case is theirs, and a report is what a person
    chose to send.
85. **A ring is agencies linked by a shared phone or fee account**, from the hashed signals people chose
    to share. The console shows how they are linked and how many cases, and says that a link is a
    reason to look, not proof. The risk numbers come from the engine's code.
86. **A warning reaches every check only when staff publish it** (`riskIndex`), with a risk between 0
    and 1 and at most five reasons; withdrawing it deletes it.
87. **Fake layouts are confirmed by a person.** A layout shared from two or more cases is listed; once
    staff confirm it, a later check with a near-identical layout is flagged. A fingerprint must be 64
    hex characters, so a pasted mistake cannot match everything.

### Licensed list import (P3)

88. **An admin can import the licensed list from a CSV file** (license_no, name and status; city and
    list_date when present). Nothing is saved until the admin has seen the preview: how many firms were
    read, how many rows were skipped and why, the count per status, and the first five rows. The list
    is saved in parts of 1,500 rows (up to 60,000 firms) under `config/recruiters`, and the summary
    document is written last, so a half-finished import is never read. The app cannot tell whether a
    file really is the regulator's; the screen says so. "Go back to the sample list" removes the import.
89. **Screens wait for the person's data store before reading the list.** React runs a screen's effects
    before its provider's, so the first screen after a page load read the sample list even after an
    import. The browser test of the import caught it.

### Offline kit

90. **A hand-written service worker, with no library.** Pages are fetched from the network first and
    the saved copy is used only when that fails; build files, fonts and pictures are served from the
    cache first, since their names change when they change. Other sites (sign-in, Firestore, Gemini)
    are never touched. Each deploy gets a new cache and deletes the old one. The quick-exit page is
    saved when the worker installs.
91. **The kit is 14 screens in the person's language, plus the packs for their own route**: about
    400 KB of pages and 416 KB of scripts and fonts, compressed. It downloads by itself 8 seconds after
    the journey is ready, unless the phone asks to save data. More has the button and the date it was
    last saved. Any screen shown from the saved copy says so in one line.
92. **Saved pages are kept without their query**, so `/cases/view/?id=...` opens the saved page and the
    page reads the case from the phone. A guest's data is on the phone already; a signed-in person's
    offline data depends on Firestore's own cache, which has not been tested.

### Dates and employer links

93. **Important dates lists what the app already knows**, the passport expiry from the readiness scan
    and each case's next step, and dates the person adds. Each has a Google Calendar template link; the
    person opens it and saves the event. The app never writes to a calendar.
94. **The employer look-up is two plain links**: Google Search for the employer's name in quotes, and
    Maps for the name and address on the paper. The person reads the results; the app does not judge
    an employer from them.

### P2 and P3 items not built

95. **The visa form guide** (no pack has a form's fields with a source), **official register links for
    scholarship and admission letters** (the packs have no register URL for any destination; checking
    the letter itself is P1 and works), and a **post-arrival guide** beyond the journey's arrival stage,
    which already shows each destination's arrival checklist. From P3: admin content research with URL
    context, the anonymous BigQuery export with a Looker Studio dashboard, and the hybrid on-device
    mode.

### Quality

96. **Both hero stories run end to end in the browser** at phone size: Ahmed in Urdu and Ayesha in
    English. They found a real bug: the stamp's first frame was wider than the phone, which made the
    phone zoom the whole page out, so the sticky buttons sat under other elements. The page column now
    clips sideways overflow.
97. **Text at 200% never makes a screen wider than the phone**, tested on 25 screens (staff screens
    included) in English and Urdu. Seven failed first; fields and tile grids may now shrink below their
    natural width. The test measures after the stamp has landed, since its first frames are clipped.
98. **Keyboard only**: the skip link comes first, SOS soon after, every focus is visible, and the quick
    exit and a sample check work without a mouse.
99. **The English dictionary is no longer in every page's scripts.** Only the current language's
    strings load, about 20 KB less (compressed) on each page.
100. **Browser tests wait until the page is live** (`data-ready` on `<html>`, set once React has
     hydrated). A file or a choice made before that was lost, in the tests and on a slow phone alike.

### Spanner Graph (15 October 2026)

101. **Spanner gets its own settings: `SPANNER_PROJECT` and `SPANNER_EMULATOR_HOST`.** The project
     defaults to `GOOGLE_CLOUD_PROJECT`; set apart, Spanner can live in a billed project of its own
     while the Firebase project stays on the no-cost plan. The emulator address is copied into the
     real environment on start, because the Spanner client reads it only from there and
     pydantic-settings does not export `.env`. The backend refuses to start in production with an
     emulator address set. `/api/meta` says which graph is in use: memory, spanner-emulator or spanner.
102. **One script applies the schema, to the emulator or a real instance**
     (`python -m app.scripts.spanner_setup`): it splits `schema.sql` into its 14 statements and skips
     what the database already has. On the emulator it also creates the instance; it never creates a
     real one, and runs against real Spanner only with `--real`.
103. **The graph tests run through the API on every backend**: two checks that share a phone and their
     fraud cases make one ring in the NGO console, the agent check sees the risk, the GQL query on
     `IntegrityGraph` agrees, and hidden instructions are flagged. On memory they always run; on
     Spanner when `GRAPH_BACKEND=spanner` is set (real Spanner also needs `PG_SPANNER_REAL=1`). Each run
     uses its own made-up names and deletes its rows.
104. **`infra/setup.sh` creates the Spanner free trial instance by default** (no charge for 90 days,
     Spanner Graph included, billing still has to be linked). A billed Enterprise instance needs
     `SPANNER_PAID=1`.

105. **At $0 Spanner runs only on the emulator.** Every real Spanner instance, the free trial one
     included, needs billing linked, and the project has none. The live app's integrity network
     (rings, alerts, warnings) already runs on Firestore in the browser, so nothing a judge uses
     depends on Spanner.
106. **The backend can run as a free sandbox on Render** (`render.yaml`): memory store and graph, the
     free Gemini tier, and a new `AUTH_MODE=demo` in which every caller is a worker. The brief's rule
     is that a role never comes from the client; `dev` mode takes it from a header, so it stays for
     local work only. The default Pro model has no free tier, so the sandbox sets
     `MODEL_PRO=gemini-3.8-flash`.

107. **`LLM_BACKEND=auto` lets the API switch between Gemini and the offline path by itself.** With a
     key it tries Gemini; a quota, network or key failure sends that call to the offline path and
     skips Gemini for `AI_COOLDOWN_SECONDS` (60), so nobody waits on retries. The offline path invents
     nothing: a paper is marked unread and gets `READER_UNAVAILABLE` (medium, so never green), the
     rules use what the person typed, and explanations and letters come from templates. The test
     reader (`fake`) is not used as a fallback, because it parses fixture text and would pass a real
     paper it never read. The assistant answers 503 with a reason instead of a server error.
108. **`backend/.env.example` is split by where the API runs**: what $0 needs, the optional local
     Spanner emulator, and the production design's paid services, which stay empty at $0.

### Production API on Cloud Run (16 October 2026)

109. **The team linked billing to `pardes-ea3e1`, so the backend can run on Cloud Run in the same
     project** as the web app. One project means the service account reaches Firestore, Spanner, KMS
     and Agent Platform without keys. The web app is unchanged and still does not call the API.
110. **The deployed API runs as a sandbox by default (`ENV=demo`, `AUTH_MODE=demo`)**: real services,
     the API docs at `/api/docs`, nobody signed in, every caller a worker, staff routes closed. The
     backend refuses to start a sandbox with dev sign-in, dev secrets or an emulator address.
     `MODE=prod` deploys with Firebase sign-in and no docs.
111. **The API writes to its own Firestore database (`pardes-api`).** The web app's `(default)`
     database uses the same collection names (`checks`, `cases`, `evidence`) for documents of another
     shape, and the API's service account bypasses the rules.
112. **What is claimed follows `backend/LIVE_CHECK.md`.** `live_check.py` (standard library only) runs
     made-up papers through the deployed API and records, service by service, what it saw. The README
     and the deck name a service as running only after its line passed.
113. **Cost guards:** the Spanner free trial instance, at most 3 Cloud Run instances, Model Armor
     within its free 2 million tokens a month, a 20 USD budget alert, and the teardown commands in
     `infra/CLOUD_RUN.md`.

114. **The Render sandbox is dropped** (`render.yaml` removed). With billing on the project, the API
     sandbox runs on Cloud Run with the real services instead (109-113), so judges see one backend,
     on Google Cloud.

### The repository as submitted (16 October 2026)

115. **The repository is set out for judges.** The README leads with the links, screenshots of the
     built app (made-up data only, from `frontend/scripts/screenshots.mjs`), the problem, how Gemini
     is used, the architecture and what has and has not been verified. The deploy steps moved to
     `docs/DEPLOY.md`, and the content still to check to `docs/CONTENT.md`. The team chose the MIT
     License. Removed from the tree, all still in the git history: the build brief
     (`PROMPT_FOR_FABLE.md`, written for the $0 plan and out of date), the local Spanner emulator
     scripts at the root and in `backend/` (replaced by `backend/app/scripts/spanner_setup.py` and
     `backend/tests/test_graph_integration.py`), and three `.bak` copies of backend files.
116. **GitHub Actions runs the fast tests on every push** (`.github/workflows/tests.yml`): the web
     app's type check, unit tests and build, and the API's tests on Python 3.12, the Dockerfile's
     version. No secrets are needed. The browser tests stay a manual step (about six minutes).
117. **Draft content is labelled "Prototype", with the official site to confirm it on** (asked by the
     team). The draft badge, the journey and cost notes, the document guides and the check's rule
     note now say the information is a prototype, not yet confirmed with the official source, and
     point to the official website. They do not say an authority is reviewing it: none has been asked.
     The status in the packs stays `draft`.
118. **Each Pakistani document guide links to its issuer's own site** (opened on 16 October 2026):
     passport to dgip.gov.pk; CNIC and FRC to NADRA's Pak Identity portal (id.nadra.gov.pk, named for
     both on mofa.gov.pk); HEC attestation to hec.gov.pk; MOFA attestation to apostille.mofa.gov.pk;
     IBCC equivalence to ibcc.edu.pk; and the UK TB test to gov.uk. Their domains are added to
     `official_domains`. Only the link is filled: steps, fees and times stay empty until someone reads
     the official page. The police certificate has no link, because each province or district issues
     it and no single official page was found.
119. **The web app writes the real AI error to the browser console** ("Pardes Guard: <model> failed",
     with the SDK's code, HTTP status and message), because the screen shows "could not reach" both
     for a network failure and for every model refusing the request.

### Gemini on the live link (17 October 2026)

What the live link returned, in order, and what was done (each seen in the browser's Network tab):

| Response | Cause | Fix |
|---|---|---|
| 400 "Firebase AI Logic genai config not found" | AI Logic's guided setup had never run; the APIs had been enabled another way | Gemini Developer API disabled, then AI Logic > Get started run to the end |
| 401 "Firebase App Check token is invalid" | The setup turned on App Check enforcement for AI Logic; the app sends no App Check token | App Check > APIs > Firebase AI Logic set to Unenforced |
| 429 "Your prepayment credits are depleted" | With Cloud Billing linked, the Gemini Developer API is on the paid tier, which needs a prepaid balance in AI Studio; Google's billing page says the $300 trial credits and welcome credits do not cover it | Entry 120 |

120. **The web app's Gemini moves to the Agent Platform Gemini API** (`AgentPlatformBackend` in
     `lib/ai-firebase.ts`, location `global`). It is billed to the project's Cloud Billing account,
     whose credits the team holds, instead of a separate prepaid balance. The reading schemas go in
     `responseSchema`, the OpenAPI form they are written in (`nullable`, `enum`), not
     `responseJsonSchema`. Voice uses `gemini-live-2.5-flash-native-audio` in `us-central1`, because
     Agent Platform has no Gemini 3.x Live model and serves its 2.5 Live models outside `global`
     (Firebase AI Logic's model list). Gemma stays last in the reading chain but is not on that list
     for Agent Platform, so a refusal just ends the chain. The privacy and AI notices no longer say
     "free version" or that Google may use what is sent to improve its products (that was the
     Gemini API's unpaid-services wording); they say what is sent where. Not run against Google
     from the build environment: the first live test is on the deployed link.
121. **App Check stays unenforced for AI Logic, and AI monitoring off, for the submission.** Turning
     App Check on needs a reCAPTCHA provider in the app and testing; until then the budget alert is
     the guard against misuse of the public web key. AI monitoring was left off because it was not
     confirmed what it records from the papers people check. Firebase's App Check page says that
     from 2 November 2026 App Check enforcement will be required to use Firebase AI Logic; if the
     live link must keep its AI after that date, the app needs App Check with reCAPTCHA Enterprise
     before then.

### Production API deployed (17 October 2026)

122. **The API runs on Cloud Run in `pardes-ea3e1`** (asia-south1, sandbox mode), deployed from Cloud
     Shell with `infra/setup.sh` and `infra/deploy.sh`. `live_check.py` passed 13 of 13 against it
     (`backend/LIVE_CHECK.md`, written by the run, copied into the repository unchanged). Cloud Run's
     logs for that hour have no "Model Armor screen failed" or "Sensitive Data Protection pass
     failed" warning, which is the evidence that those two ran: both fall back to the local screen
     silently, so a PASS alone would not show it. The case timer, run once with
     `gcloud scheduler jobs run pardes-case-tick`, got a 200 (Cloud Run request log) and the job shows
     no error; the same log query returning that line shows the empty warning query was not a
     broken query.
123. **Both scripts point gcloud at Model Armor's regional endpoint**
     (`CLOUDSDK_API_ENDPOINT_OVERRIDES_MODELARMOR`). Without it, `gcloud model-armor templates create`
     answered PERMISSION_DENIED for the project owner; with it the template was created. The API
     itself already called the regional endpoint.
124. **`setup.sh` enables `compute.googleapis.com` first**, so that the Compute Engine default
     service account exists: Cloud Build uses it in new projects, and `setup.sh` grants it a role. On
     `pardes-ea3e1` it was enabled by hand just before `setup.sh` ran.

125. **The assistant keeps Gemini's thought signatures** (`lib/ai-chat-wire.ts`). On the live link
     the assistant's first request got a function call back (200) and the request carrying the
     function's result got a 400 within a second, from both models in the chain. Gemini 3 attaches
     a thought signature to a function call and requires it back in the next request; the app
     rebuilt the history without it. Each model turn now keeps its parts' signatures and the model
     that wrote them; a call written by another model (a fallback mid-conversation) gets the
     placeholder from Google's thought-signature guide on its first call. A local capture of the
     SDK's request shows `thoughtSignature` reaching the wire beside `functionCall`. Not yet run
     against Google.

## Not tested, and why

Updated 17 October 2026: the deployed API now has passed its live check (entry 122), and the live
link's paper check got a 200 from Gemini on Agent Platform (entry 120). The list below is otherwise
as it was written before anything ran against Google.

The build environment cannot reach any Google host, so none of this has run:

- Google sign-in, Firestore reads and writes, and the Firestore rules (the emulator download is blocked;
  `npm run test:rules` is written and waits for a machine with Java).
- Any Gemini call, including whether Firebase AI Logic accepts the Gemma model id, reads our JSON
  schemas, takes WAV voice notes, or reads identity papers well. The AI-mode screens were checked only
  in a build with placeholder Firebase values, to see the layout.
- The `X-Frame-Options: DENY` header together with Firebase Auth's popup helper on `/__/auth/*`.
- A real phone: Urdu rendering on Android, "Listen" voices, voice typing, the microphone for voice
  notes, and the camera button. The date field follows the phone's own format (a US-English phone shows
  month first).
- Phase 3: function calling, the Live API (voice, transcripts, functions by voice, how sessions end),
  the letter drafts, the interview feedback, and reading a family share without signing in. With
  placeholder Firebase values every one of these fails with "could not reach", which is the expected
  message; the success path has only run against stand-in transports in the unit tests.
- Hindi, Bengali and Nepali dates in the test browser: its Chromium shows "Oct" for Nepali, which a
  phone's full language data should not.
- Cloud Run: `infra/setup.sh`, `infra/deploy.sh` and the API image have not run here (no Google access
  from this environment); `live_check.py` was run only against a local sandbox-mode server.
- Spanner: the graph tests and `spanner_setup` were run here only on the in-memory graph and with the
  emulator address pointing nowhere (the emulator download is blocked in this environment). The team
  reports that the Spanner store passed against the emulator on their machine before this change; no
  real Spanner instance exists yet (the project has no billing).
- Phase 4: the offline kit on a real phone and on Firebase Hosting (it was tested only on the local
  preview server, in desktop Chromium at phone size), a signed-in person's data offline, the staff
  screens with a real `roles/{uid}` document, and the new admin-only rule for the licensed list
  (written into `npm run test:rules`, which has not run).

## Waiting on the team

The same list, with where each item comes from and where it goes, is in `docs/CONTENT.md` under
"What is left, and where it goes".

- Firebase console setup (brief section 13) and the four web config values.
- Verified content for the two hero routes: every document guide field, fees with sources, Pakistan's
  legal maximum recruitment fee with its source, and help contacts for Saudi Arabia and the United
  Kingdom (the packs have none, so SOS says so).
- A native reader for the Urdu strings and pack translations, and for the Hindi, Bengali, Nepali and
  Filipino drafts (each draft lists its open questions in the Phase 3 report).
- Interview topics for the other routes, from an official source.
- Help contacts (embassy, legal aid) for the destination packs that have none.
- Passport validity rules for each route (months required, with the official source).
- The official list of licensed promoters as a CSV file (an admin imports it on the Admin screen), or
  the exact official search page to link to.
- Staff accounts: a `roles/{uid}` document per person, `ngo` or `admin`, made in the Firebase console.
- Official register links for admission letters, and visa form details with sources, if those P2
  items are wanted.
