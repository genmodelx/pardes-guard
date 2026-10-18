// Integrity network: links recruiters across separate reports so fraud rings show up.
// Ported from backend/app/services/network.py.
//
// Workers who opt in share signals (recruiter licence or name, the recruiter's phone and fee
// account, document layout fingerprints). Phones and accounts are hashed before they leave the
// phone. Only NGO staff read the signals; they review the rings and publish warnings that every
// worker's check then uses. In this free-tier build hashing happens in the browser, so the hashes
// are pseudonymous rather than secret-keyed; the Cloud Run version uses a server-side secret.

import type { NetworkAlert, Ring } from "@/lib/types";
import { normalizeAccount, normalizeLicense, normalizeName, normalizePhone, sha256Hex } from "./text";

const FRAUD_CASE_WEIGHT = 0.15;
const SHARED_PHONE_WEIGHT = 0.35;
const SHARED_ACCOUNT_WEIGHT = 0.3;
const RING_WEIGHT = 0.2;
const ACCOUNT_CASES_THRESHOLD = 3;
const EMPLOYER_WAGE_THRESHOLD = 3;
const PEPPER = "pardes-guard-network-v1";

/** One opted-in report, as stored. Identifiers are already hashed. */
export interface Signal {
  case_id: string;
  owner_id?: string;
  recruiter_key: string | null;
  recruiter_label: string | null;
  phones: string[];
  accounts: string[];
  employer_key: string | null;
  layouts: string[];
  fraud: boolean;
  wage_problem: boolean;
  created_at?: string;
}

async function token(kind: string, value: string): Promise<string> {
  return `${kind}_${(await sha256Hex(`${PEPPER}:${kind}:${value}`)).slice(0, 24)}`;
}

export async function recruiterKey(license: string | null | undefined, name: string | null | undefined): Promise<string | null> {
  const lic = normalizeLicense(license);
  if (lic) return `lic_${lic}`;
  const n = normalizeName(name);
  return n ? token("nm", n) : null;
}

export async function makeSignal(input: {
  caseId: string;
  license?: string | null;
  name?: string | null;
  phones?: string[];
  accounts?: string[];
  employer?: string | null;
  layouts?: string[];
  fraud?: boolean;
  wageProblem?: boolean;
}): Promise<Signal> {
  const phones = (await Promise.all((input.phones ?? []).map((p) => normalizePhone(p)).filter((p) => p.length >= 8).map((p) => token("ph", p))));
  const accounts = await Promise.all(
    (input.accounts ?? []).map((a) => normalizeAccount(a)).filter((a) => a.length >= 6).map((a) => token("ac", a)),
  );
  const employerName = normalizeName(input.employer);
  return {
    case_id: input.caseId,
    recruiter_key: await recruiterKey(input.license, input.name),
    // What staff read: the licence number, else the name as written (a name is not a secret).
    recruiter_label: normalizeLicense(input.license) || input.name?.replace(/\s+/g, " ").trim().slice(0, 120) || null,
    phones: [...new Set(phones)],
    accounts: [...new Set(accounts)],
    employer_key: employerName ? await token("nm", employerName) : null,
    layouts: [...new Set(input.layouts ?? [])],
    fraud: Boolean(input.fraud),
    wage_problem: Boolean(input.wageProblem),
  };
}

/** The graph built from all signals; the same scoring as the Python MemoryGraphStore. */
export class Graph {
  private recruiterPhones = new Map<string, Set<string>>();
  private phoneRecruiters = new Map<string, Set<string>>();
  private recruiterAccounts = new Map<string, Set<string>>();
  private accountRecruiters = new Map<string, Set<string>>();
  private accountCases = new Map<string, Set<string>>();
  private recruiterCases = new Map<string, Set<string>>();
  private recruiterFraud = new Map<string, Set<string>>();
  private employerWage = new Map<string, Set<string>>();
  private layoutCases = new Map<string, Set<string>>();
  private labels = new Map<string, string>();

  constructor(
    signals: Signal[],
    private fakeLayouts: Set<string> = new Set(),
  ) {
    const add = (m: Map<string, Set<string>>, k: string, v: string) => {
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(v);
    };
    for (const s of signals) {
      const r = s.recruiter_key;
      if (r) {
        if (!this.labels.has(r)) this.labels.set(r, s.recruiter_label ?? r);
        add(this.recruiterCases, r, s.case_id);
        if (s.fraud) add(this.recruiterFraud, r, s.case_id);
        for (const p of s.phones) {
          add(this.recruiterPhones, r, p);
          add(this.phoneRecruiters, p, r);
        }
        for (const a of s.accounts) {
          add(this.recruiterAccounts, r, a);
          add(this.accountRecruiters, a, r);
        }
      }
      for (const a of s.accounts) add(this.accountCases, a, s.case_id);
      if (s.wage_problem && s.employer_key) add(this.employerWage, s.employer_key, s.case_id);
      for (const l of s.layouts) add(this.layoutCases, l, s.case_id);
    }
  }

  private components(): Set<string>[] {
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      while (parent.get(x) !== x) {
        parent.set(x, parent.get(parent.get(x)!)!);
        x = parent.get(x)!;
      }
      return x;
    };
    for (const group of [...this.phoneRecruiters.values(), ...this.accountRecruiters.values()]) {
      const members = [...group].sort();
      for (const m of members.slice(1)) {
        const ra = find(members[0]);
        const rb = find(m);
        if (ra !== rb) parent.set(rb, ra);
      }
    }
    const comps = new Map<string, Set<string>>();
    for (const r of parent.keys()) {
      const root = find(r);
      if (!comps.has(root)) comps.set(root, new Set());
      comps.get(root)!.add(r);
    }
    return [...comps.values()].filter((c) => c.size >= 2);
  }

  risk(rkey: string | null): { risk: number; reasons: string[] } {
    if (!rkey) return { risk: 0, reasons: [] };
    const reasons: string[] = [];
    let risk = 0;
    const others = (own: Map<string, Set<string>>, rev: Map<string, Set<string>>) => {
      const s = new Set<string>();
      for (const x of own.get(rkey) ?? []) for (const r of rev.get(x) ?? []) if (r !== rkey) s.add(r);
      return s;
    };
    const viaPhone = others(this.recruiterPhones, this.phoneRecruiters);
    const viaAccount = others(this.recruiterAccounts, this.accountRecruiters);
    if (viaPhone.size) {
      risk += SHARED_PHONE_WEIGHT;
      reasons.push(`Shares a phone number with ${viaPhone.size} other recruiter(s)`);
    }
    if (viaAccount.size) {
      risk += SHARED_ACCOUNT_WEIGHT;
      reasons.push(`Collects fees into an account also used by ${viaAccount.size} other recruiter(s)`);
    }
    const busy = [...(this.recruiterAccounts.get(rkey) ?? [])].some((a) => (this.accountCases.get(a)?.size ?? 0) >= ACCOUNT_CASES_THRESHOLD);
    if (busy && !viaAccount.size) {
      risk += SHARED_ACCOUNT_WEIGHT / 2;
      reasons.push("Its fee account appears in several workers' cases");
    }
    const fraud = this.recruiterFraud.get(rkey)?.size ?? 0;
    if (fraud) {
      risk += Math.min(3, fraud) * FRAUD_CASE_WEIGHT;
      reasons.push(`Linked to ${fraud} reported fraud case(s)`);
    }
    if (this.components().some((c) => c.has(rkey))) {
      risk += RING_WEIGHT;
      reasons.push("Part of a connected group of recruiters");
    }
    return { risk: Math.round(Math.min(1, risk) * 100) / 100, reasons };
  }

  /** Every recruiter key that has any signal, for publishing warnings. */
  recruiterKeys(): string[] {
    return [...this.recruiterCases.keys()];
  }

  label(rkey: string): string {
    return this.labels.get(rkey) ?? rkey;
  }

  rings(): Ring[] {
    const rings = this.components().map((members) => {
      const root = [...members].sort()[0];
      const phones = new Set([...members].flatMap((m) => [...(this.recruiterPhones.get(m) ?? [])]));
      const accounts = new Set([...members].flatMap((m) => [...(this.recruiterAccounts.get(m) ?? [])]));
      const shared = (ids: Set<string>, rev: Map<string, Set<string>>) =>
        [...ids].filter((x) => [...(rev.get(x) ?? [])].filter((r) => members.has(r)).length > 1).length;
      const sharedPhones = shared(phones, this.phoneRecruiters);
      const sharedAccounts = shared(accounts, this.accountRecruiters);
      const cases = new Set([...members].flatMap((m) => [...(this.recruiterCases.get(m) ?? [])])).size;
      const risk = Math.min(1, 0.3 + 0.1 * members.size + 0.1 * sharedAccounts + 0.05 * cases);
      return {
        id: `ring_${root.slice(-10)}`,
        recruiters: [...members].map((m) => this.label(m)).sort(),
        shared_phones: sharedPhones,
        shared_accounts: sharedAccounts,
        cases,
        risk: Math.round(risk * 100) / 100,
      };
    });
    return rings.sort((a, b) => b.risk - a.risk);
  }

  alerts(): NetworkAlert[] {
    const out: NetworkAlert[] = this.rings().map((r) => ({
      pattern: "recruiter_ring",
      severity: r.risk >= 0.6 ? "high" : "medium",
      description: `${r.recruiters.length} recruiters share phones or fee accounts across ${r.cases} case(s)`,
      entities: r.recruiters,
      cases: r.cases,
    }));
    for (const [account, cases] of this.accountCases) {
      if (cases.size >= ACCOUNT_CASES_THRESHOLD) {
        out.push({ pattern: "fee_collector", severity: "high", description: `One fee account appears in ${cases.size} workers' cases`, entities: [account], cases: cases.size });
      }
    }
    for (const [employer, cases] of this.employerWage) {
      if (cases.size >= EMPLOYER_WAGE_THRESHOLD) {
        out.push({ pattern: "bad_employer", severity: "medium", description: `An employer has ${cases.size} wage cases`, entities: [employer], cases: cases.size });
      }
    }
    for (const layout of this.fakeLayouts) {
      out.push({
        pattern: "fake_template",
        severity: "high",
        description: `A confirmed fake document layout, seen in ${this.layoutCases.get(layout)?.size ?? 0} case(s)`,
        entities: [layout],
        cases: this.layoutCases.get(layout)?.size ?? 0,
      });
    }
    return out;
  }
}
