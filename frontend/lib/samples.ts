// The fictional sample papers (scripts/build-samples.mjs writes data/samples.json and the images).

import raw from "@/data/samples.json";
import { addMonths, type IdentityReading } from "@/lib/engine/readiness";
import type { ExtractedDocument, WorkerStatement } from "@/lib/types";

export interface Sample {
  id: string;
  persona: string;
  title: { en: string; ur?: string } & Record<string, string | undefined>;
  context: { origin: string; destination: string; purpose: "work" | "study" };
  documents: { image: string; mime_type: string; reading: Omit<ExtractedDocument, "doc_id" | "injection_suspected" | "layout_hash"> }[];
  statement: { text: string; lang: string; reading: WorkerStatement } | null;
  expect: { level: "red" | "amber" | "green"; flags: string[] };
}

export const SAMPLES = (raw as unknown as { samples: Sample[] }).samples;

export function sampleById(id: string | null | undefined): Sample | null {
  return SAMPLES.find((s) => s.id === id) ?? null;
}

export function sampleTitle(sample: Sample, locale: string): { text: string; lang?: string } {
  const own = sample.title[locale];
  return own ? { text: own } : { text: sample.title.en, lang: "en" };
}

// ---- Readiness scan --------------------------------------------------------------------------------

/**
 * Fictional papers for trying the readiness scan: readings only, no pictures (the app never shows
 * an imitation passport). The passport's expiry is set from today, so the sample always shows a
 * passport that runs out soon. One spelling differs and one name is in another order, so every
 * kind of result appears.
 */
export function readinessSample(today: string): IdentityReading[] {
  const sample = (id: string, kind: IdentityReading["kind"], full_name: string, expiry_date: string | null = null): IdentityReading => ({ id: `sample_${id}`, kind, full_name, expiry_date, source: "typed", confidence: 1 });
  return [
    sample("passport", "passport", "AYESHA MALIK", addMonths(today, 5)),
    sample("admission", "admission_letter", "Aisha Malik"),
    sample("degree", "education_certificate", "Malik Ayesha"),
  ];
}

export const isSampleReading = (reading: IdentityReading) => reading.id.startsWith("sample_");
