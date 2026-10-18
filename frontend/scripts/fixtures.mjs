// Fictional people for screenshots and browser tests. They are written straight into the browser's
// storage as guest data (LocalStore), so no sign-in and no network is needed. Not real people.

export const GUEST = "guest_5a17e0c4b9d2a6f1";

const at = "2026-10-13T09:00:00Z";

/** Browser-storage entries for a guest with a saved journey. */
export function journeyStorage(answers, items = {}, stageDoneAt = {}) {
  const journey = {
    owner_id: GUEST,
    version: 1,
    answers,
    items: Object.fromEntries(Object.entries(items).map(([id, status]) => [id, { status, updated_at: at }])),
    stage_done_at: stageDoneAt,
    created_at: at,
    updated_at: at,
  };
  return {
    "pg.guest": GUEST,
    "pg.db.journeys": {
      [GUEST]: { owner_id: GUEST, journey, settings: { ai_language: null, share_signals: false }, signal_ids: [], report_ids: [], updated_at: at },
    },
  };
}

export const AHMED = { purpose: "work", origin: "PK", destination: "SA", route_id: "sa-work" };
export const AYESHA = { purpose: "study", origin: "PK", destination: "GB", route_id: "gb-student" };

/** Ahmed has finished "Before you pay" and started on his papers. */
export const ahmedStorage = () =>
  journeyStorage(AHMED, { "app:checkOffer": "done", "app:checkAgent": "done", "app:cost": "done", "doc:passport": "done", "doc:gulf-medical": "doing" }, { before: at });

/** Ayesha has just answered the three questions. */
export const ayeshaStorage = () => journeyStorage(AYESHA);

/** The same storage with saved readiness results: fictional readings only, never a photo. */
export function withReadiness(storage, papers) {
  const users = storage["pg.db.journeys"];
  const record = users[GUEST];
  return { ...storage, "pg.db.journeys": { ...users, [GUEST]: { ...record, readiness: { scanned_at: at, papers } } } };
}

const reading = (id, kind, full_name, expiry_date = null) => ({ id, kind, full_name, expiry_date, source: "typed", confidence: 1 });

/** Ahmed has scanned his passport and ID card. There is no passport rule for his visa in the packs yet. */
export const ahmedReadyStorage = () => withReadiness(ahmedStorage(), [reading("pap_1", "passport", "AHMED RAZA", "2027-01-20"), reading("pap_2", "national_id", "Ahmed Raza")]);

/** As above, but the passport has run out. */
export const ahmedExpiredStorage = () => withReadiness(ahmedStorage(), [reading("pap_1", "passport", "AHMED RAZA", "2026-08-01")]);

const STEP_NAMES = {
  notice_employer: "Formal notice to the employer or recruiter",
  complaint_embassy: "Complaint to the embassy or Community Welfare Attaché",
  handoff_legal_aid: "Hand the case to a legal-aid partner",
  complaint_regulator: "Complaint to the emigration regulator",
};

const step = (index, action, due, status, draft = null) => ({ index, name: STEP_NAMES[action], action, due_at: due, status, draft, channel: status === "sent" ? "whatsapp" : null, decided_at: null, sent_at: status === "sent" ? due : null });

const LETTER = "Dear Sir or Madam,\n\nI am writing about my employment.\n\nIssue: Pay for September 2026\n\nYou were paid 1,200 SAR, but the contract says 1,800 SAR: 600 SAR short (33.3%).\n\nCase reference: case_fixture02\n\nI request that this is resolved and that I receive a written reply.\n\nRespectfully,\n[Your name]\n[Date]";

/** Fictional cases: one with a letter waiting for approval, one emergency with its first letter sent. */
export const FIXTURE_CASES = {
  case_fixture02: {
    id: "case_fixture02",
    owner_id: GUEST,
    kind: "wage_short",
    severity: "medium",
    status: "awaiting_approval",
    title: "Pay for September 2026",
    summary: "You were paid 1,200 SAR, but the contract says 1,800 SAR: 600 SAR short (33.3%).",
    origin_country: "PK",
    destination_country: "SA",
    created_at: "2026-10-12T08:00:00Z",
    updated_at: "2026-10-12T08:00:00Z",
    ladder: [step(0, "notice_employer", "2026-10-12T08:00:00Z", "awaiting_approval", LETTER), step(1, "complaint_embassy", "2026-10-19T08:00:00Z", "scheduled"), step(2, "handoff_legal_aid", "2026-10-26T08:00:00Z", "scheduled")],
    events: [
      { at: "2026-10-12T08:00:00Z", actor: GUEST, kind: "opened", detail: "Case opened: wage_short" },
      { at: "2026-10-12T08:00:00Z", actor: "system", kind: "step_ready", detail: "Ready for your approval", step: 0 },
    ],
    evidence_ids: [],
    related_check_id: null,
    family_share_code: null,
    needs_human_review: false,
  },
  case_fixture03: {
    id: "case_fixture03",
    owner_id: GUEST,
    kind: "emergency",
    severity: "high",
    status: "escalating",
    title: "Passport taken, room locked",
    summary: "The employer took my passport and locks the room at night.",
    origin_country: "PK",
    destination_country: "SA",
    created_at: "2026-10-10T20:00:00Z",
    updated_at: "2026-10-11T09:00:00Z",
    ladder: [step(0, "complaint_embassy", "2026-10-10T20:00:00Z", "sent", "To the Community Welfare Attaché, ..."), step(1, "handoff_legal_aid", "2026-10-17T20:00:00Z", "scheduled")],
    events: [
      { at: "2026-10-10T20:00:00Z", actor: GUEST, kind: "opened", detail: "Case opened: emergency" },
      { at: "2026-10-10T20:00:00Z", actor: GUEST, kind: "emergency", detail: "Emergency case opened" },
      { at: "2026-10-11T09:00:00Z", actor: GUEST, kind: "step_sent", detail: "Sent via whatsapp", step: 0, channel: "whatsapp" },
    ],
    evidence_ids: [],
    related_check_id: null,
    family_share_code: null,
    needs_human_review: true,
  },
};

/** A family code for the emergency case, as its owner would have created it. */
export const FIXTURE_SHARE_CODE = "K7QF2MPX9TRD4H";

function fixtureShare() {
  const c = FIXTURE_CASES.case_fixture03;
  return {
    owner_id: GUEST,
    case_id: c.id,
    updated_at: c.updated_at,
    view: {
      title: c.title,
      status: c.status,
      kind: c.kind,
      destination_country: c.destination_country,
      updated_at: c.updated_at,
      steps: c.ladder.map((s) => ({ name: s.name, status: s.status, action: s.action })),
      alerts: [{ case_id: c.id, message: "emergency", created_at: c.created_at }],
    },
  };
}

/** Ahmed abroad with two cases; the emergency one is shared with his family. */
export const ahmedCasesStorage = () => ({
  ...ahmedStorage(),
  "pg.db.cases": { ...FIXTURE_CASES, case_fixture03: { ...FIXTURE_CASES.case_fixture03, family_share_code: FIXTURE_SHARE_CODE } },
  "pg.db.shares": { [FIXTURE_SHARE_CODE]: fixtureShare() },
});

/** A made-up licensed list for the admin import: three firms that read, two rows that do not. */
export const IMPORT_CSV = [
  "license_no,name,status,city,list_date",
  "IMP0001LHR,Bright Road Overseas (Fictional Import),active,Lahore,2026-09-30",
  'IMP0002KHI,"Sea Gate Manpower, Karachi (Fictional Import)",suspended,Karachi,2026-09-30',
  "IMP0003ISB,Old Bridge Promoters (Fictional Import),cancelled,Islamabad,2026-09-30",
  ",No Licence Firm,active,,",
  "IMP0005PEW,Unknown Status Firm,pending,,",
].join("\n");
