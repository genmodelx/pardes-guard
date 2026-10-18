// Mirrors backend/app/schemas.py and the router response models. Keep the two in step.

export type Severity = "high" | "medium" | "low" | "info";
export type VerdictLevel = "red" | "amber" | "green";
export type ContentStatus = "draft" | "verified";
export type Role = "worker" | "family" | "ngo" | "admin";
export type Period = "month" | "week" | "day" | "hour" | "once";

export interface SourceRef {
  title: string;
  url: string;
}

/**
 * Translations kept beside the English source: { ur: { title: "...", steps: ["...", "..."] } }.
 * A field with no translation is shown in English. See `localized()` in lib/engine/packs.ts.
 */
export type Translations = Record<string, Record<string, string | string[]>>;

export interface Translatable {
  i18n?: Translations;
}

/** Who does a step. "worker" is shown to the reader as "You". */
export type Actor = "worker" | "employer" | "recruiter" | "government" | "university";

export interface Money {
  amount: number;
  currency: string;
  period?: Period;
}

export interface Channel extends Translatable {
  name: string;
  url?: string | null;
  description?: string | null;
}

export interface ExtractedDocument {
  doc_id: string;
  doc_type: string;
  language?: string | null;
  employer_name?: string | null;
  employer_address?: string | null;
  recruiter_name?: string | null;
  recruiter_license_no?: string | null;
  recruiter_phones: string[];
  job_title?: string | null;
  visa_type?: string | null;
  visa_occupation?: string | null;
  destination_country?: string | null;
  salary?: Money | null;
  weekly_hours?: number | null;
  contract_months?: number | null;
  accommodation_provided?: boolean | null;
  food_provided?: boolean | null;
  medical_covered?: boolean | null;
  return_ticket_provided?: boolean | null;
  passport_held_by_employer?: boolean | null;
  fee_amount?: Money | null;
  fee_account?: string | null;
  notable_clauses: string[];
  raw_text_excerpt?: string | null;
  /** Text on the page that speaks to an AI or a checker. Never obeyed; any entry flags the document. */
  instructions_to_ai?: string[];
  confidence: number;
  injection_suspected: boolean;
  layout_hash?: string | null;
}

export interface WorkerStatement {
  transcript?: string | null;
  language?: string | null;
  promised_salary?: Money | null;
  fee_asked?: Money | null;
  fee_paid_cash_only?: boolean | null;
  receipt_given?: boolean | null;
  recruiter_name?: string | null;
  recruiter_phone?: string | null;
  recruiter_license_no?: string | null;
  promised_job_title?: string | null;
  other_claims: string[];
}

export interface Evidence {
  doc_id: string;
  field: string;
  value: string;
}

/** Who a flag says to confirm with, as a code the screens can translate. */
export type VerifyWith = "visa_platform" | "labour_ministry" | "labour_ministry_or_embassy" | "regulator";

export interface Flag {
  code: string;
  severity: Severity;
  /** English. Screens show `flag.<code>` from the dictionary and fall back to this. */
  title: string;
  /** English, with the values filled in. Kept for stored checks and letters. */
  explanation: string;
  evidence: Evidence[];
  sources: SourceRef[];
  verify_with?: string | null;
  /** The same as verify_with, as a code. */
  verify?: VerifyWith;
  /** The values the explanation was built from, so it can be said in another language. */
  params?: Record<string, string | number | string[]>;
  /** Which wording of the explanation applies ("banned", "borrowed", "suspended"). */
  variant?: string;
}

export interface RecruiterRecord {
  license_no: string;
  name: string;
  city?: string | null;
  status: "active" | "suspended" | "cancelled";
  source: "official_list" | "sample";
  list_date?: string | null;
  rating_avg?: number | null;
  rating_count: number;
}

export type RecruiterStatus =
  | "licensed_active"
  | "licensed_suspended"
  | "licensed_cancelled"
  | "not_found"
  | "ambiguous"
  | "not_checked";

export interface RecruiterCheck {
  query_name?: string | null;
  query_license?: string | null;
  status: RecruiterStatus;
  match?: RecruiterRecord | null;
  candidates: RecruiterRecord[];
  network_risk: number;
  network_reasons: string[];
  list_is_sample: boolean;
}

export interface Verdict {
  check_id: string;
  created_at: string;
  level: VerdictLevel;
  risk_score: number;
  flags: Flag[];
  top_reasons: string[];
  next_steps: string[];
  /** The same steps as codes (`next.<code>` in the dictionaries), so they can be shown in any language. */
  next_step_codes?: string[];
  recruiter?: RecruiterCheck | null;
  documents: ExtractedDocument[];
  statement?: WorkerStatement | null;
  spoken_summary?: string | null;
  content_is_draft: boolean;
  disclaimer: string;
}

export interface TestThreshold {
  test: string;
  min_overall?: number | null;
  min_each?: Record<string, number> | null;
  min_level?: string | null;
  level_order?: string[] | null;
}

export type RequirementRule =
  | { type: "range"; field: string; min?: number | null; max?: number | null }
  | { type: "min_level"; field: string; min: string; order: string[] }
  | { type: "language_any_of"; options: TestThreshold[] }
  | { type: "bool_true"; field: string };

export interface Requirement extends Translatable {
  id: string;
  kind: string;
  title: string;
  description: string;
  rule?: RequirementRule | null;
  sources: SourceRef[];
  status: ContentStatus;
  last_verified?: string | null;
}

export interface VisaStep extends Translatable {
  order: number;
  /** Stable id for remembering progress. The exporter fills in "s<order>" when a pack gives none. */
  id?: string | null;
  title: string;
  description: string;
  who: Actor;
  official_url?: string | null;
  typical_duration?: string | null;
  /** Part of the journey this step belongs to. Missing means "visa". */
  stage?: "visa" | "departure" | "arrival";
}

/** One cost on a route. `amount` is only ever set together with its source and date. */
export interface FeeItem extends Translatable {
  id: string;
  item: string;
  amount?: number | null;
  currency?: string | null;
  source?: SourceRef | null;
  last_verified?: string | null;
  /** Who normally pays, when the official source says so. */
  paid_by?: Actor | null;
  /** Origin countries this cost applies to. Empty or missing means everyone. */
  origins?: string[];
  note?: string | null;
}

export interface VisaRoute extends Translatable {
  id: string;
  name: string;
  purpose: "work" | "study" | "skilled_migration" | "seasonal";
  summary: string;
  steps: VisaStep[];
  documents: string[];
  /** Ids of document guides this route needs: looked up in the origin pack, then in this pack. */
  document_ids?: string[];
  fees?: FeeItem[];
  interview_topics?: string[];
  requirements: Requirement[];
  sources: SourceRef[];
  status: ContentStatus;
  last_verified?: string | null;
}

export interface LabourRules extends Translatable {
  passport_retention_prohibited?: boolean | null;
  max_weekly_hours?: number | null;
  minimum_monthly_wage?: Money | null;
  notes: string[];
  sources: SourceRef[];
  status: ContentStatus;
}

export interface ChecklistItem extends Translatable {
  id: string;
  title: string;
  description: string;
  official_url?: string | null;
  who?: Actor;
  /** The document guide that explains how to do this item, when there is one. */
  document_id?: string | null;
  /** Route purposes this item applies to. Empty or missing means everyone. */
  purposes?: VisaRoute["purpose"][];
}

/** How to get one paper yourself. Empty fields mean the official source has not been read yet. */
export interface DocumentGuide extends Translatable {
  id: string;
  title: string;
  summary?: string | null;
  issued_by?: string | null;
  online_or_office?: "online" | "office" | "both" | null;
  steps: string[];
  bring: string[];
  typical_time?: string | null;
  official_url?: string | null;
  sources: SourceRef[];
  status: ContentStatus;
  last_verified?: string | null;
}

export interface CountryPack extends Translatable {
  code: string;
  name: string;
  kind: "origin" | "destination" | "both";
  languages: string[];
  currency?: string | null;
  status: ContentStatus;
  last_verified?: string | null;
  official_sources: SourceRef[];
  regulator?: string | null;
  max_recruitment_fee?: Money | null;
  max_recruitment_fee_source?: SourceRef | null;
  departure_checklist: ChecklistItem[];
  /** What to do in the first week after landing. Destination packs. */
  arrival_checklist?: ChecklistItem[];
  /** Guides to the papers this country issues or asks for. */
  documents?: DocumentGuide[];
  complaint_channels: Channel[];
  embassy_contacts: Channel[];
  labour_rules: LabourRules;
  red_flag_visa_types: string[];
  visa_routes: VisaRoute[];
  ladder_days: number[];
}

export interface RouteSummary {
  id: string;
  name: string;
  purpose: string;
  status: string;
  requirement_count: number;
  language_tests: string[];
}

export interface CountrySummary {
  code: string;
  name: string;
  kind: string;
  status: string;
  currency?: string | null;
  routes: RouteSummary[];
}

export interface OriginGuide {
  code: string;
  name: string;
  regulator?: string | null;
  departure_checklist: ChecklistItem[];
  complaint_channels: Channel[];
  status: string;
}

export interface TestScore {
  test: string;
  overall?: number | null;
  components: Record<string, number>;
  level?: string | null;
}

export interface Profile {
  age?: number | null;
  education_level?: string | null;
  experience_years?: number | null;
  occupation?: string | null;
  passport_valid_months?: number | null;
  tests: TestScore[];
  has_skills_certificate?: boolean | null;
  has_police_clearance?: boolean | null;
}

export type EligibilityStatus = "met" | "not_met" | "unknown" | "manual_check";

export interface EligibilityItem {
  requirement_id: string;
  title: string;
  status: EligibilityStatus;
  /** English. Screens build the sentence in the reader's language from `why` and `params`. */
  explanation: string;
  why?: string;
  params?: Record<string, string | number>;
  sources: SourceRef[];
  content_status: ContentStatus;
}

export interface EligibilityResult {
  country: string;
  route_id: string;
  route_name: string;
  items: EligibilityItem[];
  met: number;
  not_met: number;
  unknown: number;
  content_is_draft: boolean;
  disclaimer: string;
}

export interface WageCheckRequest {
  contract_salary: Money;
  paid: Money;
  expected_pay_day?: number | null;
  paid_on?: string | null;
  period_month?: string | null;
}

export interface WageCheckResult {
  comparable: boolean;
  shortfall?: Money | null;
  shortfall_pct?: number | null;
  days_late?: number | null;
  flags: Flag[];
  recommend_case: boolean;
}

export interface EvidenceRecord {
  id: string;
  owner_id: string;
  case_id?: string | null;
  index: number;
  filename: string;
  mime_type: string;
  size: number;
  sha256: string;
  prev_hash: string;
  record_hash: string;
  signature: string;
  signer: "hmac" | "kms" | "none";
  created_at: string;
  storage_uri?: string | null;
  note?: string | null;
}

export interface VaultVerify {
  ok: boolean;
  records: number;
  first_bad_index: number | null;
  reason: string;
}

export type CaseKind =
  | "wage_short"
  | "wage_late"
  | "passport_held"
  | "contract_changed"
  | "recruiter_fraud"
  | "fraud_ring_link"
  | "emergency"
  | "other";

export const CASE_KINDS: CaseKind[] = [
  "wage_short",
  "wage_late",
  "passport_held",
  "contract_changed",
  "recruiter_fraud",
  "emergency",
  "other",
];

export type CaseStatus = "open" | "escalating" | "awaiting_approval" | "resolved" | "closed";
export type StepStatus = "scheduled" | "awaiting_approval" | "approved" | "sent" | "declined" | "skipped";
export type StepAction = "notice_employer" | "complaint_embassy" | "handoff_legal_aid" | "complaint_regulator";

export interface LadderStep {
  index: number;
  name: string;
  action: StepAction;
  due_at: string;
  status: StepStatus;
  draft?: string | null;
  channel?: string | null;
  decided_at?: string | null;
  sent_at?: string | null;
}

export interface CaseEvent {
  at: string;
  actor: string;
  kind: string;
  /** English, for the record. Screens build their own sentence from kind, step and channel. */
  detail: string;
  /** The ladder step the event is about. */
  step?: number | null;
  channel?: string | null;
}

export interface Case {
  id: string;
  owner_id: string;
  kind: CaseKind;
  severity: Severity;
  status: CaseStatus;
  title: string;
  summary: string;
  origin_country: string;
  destination_country?: string | null;
  created_at: string;
  updated_at: string;
  ladder: LadderStep[];
  events: CaseEvent[];
  evidence_ids: string[];
  related_check_id?: string | null;
  family_share_code?: string | null;
  needs_human_review: boolean;
}

export interface OpenCaseRequest {
  kind: CaseKind;
  title: string;
  summary: string;
  destination_country?: string | null;
  origin_country?: string;
  related_check_id?: string | null;
  evidence_ids?: string[];
}

export interface FamilyView {
  title: string;
  status: CaseStatus;
  kind: CaseKind;
  destination_country?: string | null;
  updated_at: string;
  /** `action` says which step it is, so the family's screen can name it in their language. */
  steps: { name: string; status: StepStatus; action?: StepAction }[];
  alerts: { case_id: string; message: string; created_at: string }[];
}

export interface Ring {
  id: string;
  recruiters: string[];
  shared_phones: number;
  shared_accounts: number;
  cases: number;
  risk: number;
}

export interface NetworkAlert {
  pattern: string;
  severity: Severity;
  description: string;
  entities: string[];
  /** How many cases the pattern was seen in, so a screen can word it in any language. */
  cases?: number;
}

export interface ContentDraft {
  id: string;
  country: string;
  route_id?: string | null;
  kind: "requirement" | "step" | "labour_rule";
  payload: Record<string, unknown>;
  citations: SourceRef[];
  created_at: string;
  status: "pending" | "approved" | "rejected";
  reviewer?: string | null;
  note?: string | null;
}

export interface DirectoryResult {
  source: string;
  list_is_sample: boolean;
  loaded_on?: string | null;
  results: RecruiterRecord[];
}

export interface ChatResponse {
  session_id: string;
  reply: string;
  tools_used: string[];
  audio_wav_base64?: string | null;
}

export interface Meta {
  llm: string;
  assistant: boolean;
  recruiter_list: { source: string; count: number };
  countries: { code: string; name: string; kind: string; status: string }[];
  content_is_draft: boolean;
}

export const EDUCATION_ORDER = [
  "none",
  "primary",
  "secondary",
  "higher_secondary",
  "diploma",
  "bachelor",
  "master",
  "phd",
] as const;
