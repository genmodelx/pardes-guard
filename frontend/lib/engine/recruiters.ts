// Licensed-recruiter directory. Ported from backend/app/services/recruiters.py.

import type { RecruiterCheck, RecruiterRecord, RecruiterStatus } from "@/lib/types";
import { distinctiveName, normalizeLicense, normalizeName, wRatio } from "./text";

const STATUS_MAP: Record<string, RecruiterRecord["status"]> = {
  active: "active",
  valid: "active",
  suspended: "suspended",
  cancelled: "cancelled",
  canceled: "cancelled",
  revoked: "cancelled",
};

const NAME_MATCH_THRESHOLD = 88;
const NAME_AMBIGUOUS_MARGIN = 4;

export interface DirectoryData {
  source: "official_list" | "sample";
  loaded_on: string | null;
  rows: RecruiterRecord[];
}

/** Parse a CSV with license_no,name,status[,city,list_date]. Quoted fields are supported. */
export function parseRecruiterCsv(text: string, source: "official_list" | "sample"): RecruiterRecord[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error("The file is empty");
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  for (const required of ["license_no", "name", "status"]) {
    if (!header.includes(required)) throw new Error("CSV must have columns: license_no, name, status");
  }
  const col = (row: string[], name: string) => (row[header.indexOf(name)] ?? "").trim();
  const byLicense = new Map<string, RecruiterRecord>();
  for (const line of lines.slice(1)) {
    const row = splitCsvLine(line);
    const lic = normalizeLicense(col(row, "license_no"));
    const name = col(row, "name");
    const status = STATUS_MAP[col(row, "status").toLowerCase()];
    if (!lic || !name || !status) continue;
    const date = header.includes("list_date") ? col(row, "list_date") : "";
    byLicense.set(lic, {
      license_no: lic,
      name,
      city: header.includes("city") ? col(row, "city") || null : null,
      status,
      source,
      list_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      rating_avg: null,
      rating_count: 0,
    });
  }
  return [...byLicense.values()];
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function statusFor(r: RecruiterRecord): RecruiterStatus {
  return r.status === "active" ? "licensed_active" : r.status === "suspended" ? "licensed_suspended" : "licensed_cancelled";
}

export class RecruiterDirectory {
  readonly source: "official_list" | "sample";
  readonly loadedOn: string | null;
  private byLicense = new Map<string, RecruiterRecord>();
  private names = new Map<string, RecruiterRecord[]>();

  constructor(data: DirectoryData) {
    this.source = data.source;
    this.loadedOn = data.loaded_on;
    for (const r of data.rows) {
      this.byLicense.set(normalizeLicense(r.license_no), r);
      const key = normalizeName(r.name);
      this.names.set(key, [...(this.names.get(key) ?? []), r]);
    }
  }

  get count(): number {
    return this.byLicense.size;
  }

  get isSample(): boolean {
    return this.source !== "official_list";
  }

  byLicenseNo(license: string | null | undefined): RecruiterRecord | null {
    const key = normalizeLicense(license);
    return key ? this.byLicense.get(key) ?? null : null;
  }

  private ranked(query: string, limit: number): [string, number][] {
    return [...this.names.keys()]
      .map((k) => [k, wRatio(query, k)] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  /** Every firm on the list, by name. */
  all(): RecruiterRecord[] {
    return [...this.byLicense.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  search(query: string, limit = 10): RecruiterRecord[] {
    const q = normalizeName(query);
    const results: RecruiterRecord[] = [];
    const exact = this.byLicenseNo(query);
    if (exact) results.push(exact);
    if (q) {
      for (const [key, score] of this.ranked(q, limit)) {
        if (score < 60) continue;
        for (const r of this.names.get(key) ?? []) if (!results.includes(r)) results.push(r);
      }
      // A city name finds the firms listed in that city.
      for (const r of this.byLicense.values()) if (r.city && normalizeName(r.city) === q && !results.includes(r)) results.push(r);
    }
    return results.slice(0, limit);
  }

  check(name: string | null | undefined, licenseNo: string | null | undefined): RecruiterCheck {
    const base = { candidates: [] as RecruiterRecord[], network_risk: 0, network_reasons: [] as string[], list_is_sample: this.isSample };
    if (!name && !licenseNo) return { ...base, status: "not_checked" };

    if (licenseNo) {
      const record = this.byLicenseNo(licenseNo);
      if (record) {
        // Compare only the distinctive part of the two names: "Sunrise Manpower Promoters" and
        // "Northstar Employment Promoters" share their generic words but are different firms.
        if (name && wRatio(distinctiveName(name), distinctiveName(record.name)) < 70) {
          // The licence exists but belongs to a differently named firm: the borrowed-licence trick.
          return { ...base, query_name: name, query_license: licenseNo, status: "ambiguous", match: record, candidates: [record] };
        }
        return { ...base, query_name: name ?? null, query_license: licenseNo, status: statusFor(record), match: record };
      }
    }

    if (name) {
      const q = normalizeName(name);
      const good = this.ranked(q, 3).filter(([, s]) => s >= NAME_MATCH_THRESHOLD);
      const candidates = good.flatMap(([k]) => this.names.get(k) ?? []);
      if (licenseNo && candidates.length) {
        // The name matches a licensed firm but the number given does not.
        return { ...base, query_name: name, query_license: licenseNo, status: "ambiguous", candidates: candidates.slice(0, 5) };
      }
      if (candidates.length === 1) {
        return { ...base, query_name: name, status: statusFor(candidates[0]), match: candidates[0] };
      }
      if (candidates.length > 1) {
        const top = good[0][1];
        const second = good.length > 1 ? good[1][1] : 0;
        const topRecords = this.names.get(good[0][0]) ?? [];
        if (top - second >= NAME_AMBIGUOUS_MARGIN && topRecords.length === 1) {
          return { ...base, query_name: name, status: statusFor(topRecords[0]), match: topRecords[0] };
        }
        return { ...base, query_name: name, status: "ambiguous", candidates: candidates.slice(0, 5) };
      }
    }
    return { ...base, query_name: name ?? null, query_license: licenseNo ?? null, status: "not_found" };
  }
}
