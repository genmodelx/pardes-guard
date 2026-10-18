// Words a first-time traveller may not know. When one appears in a step or a document guide, the
// screen offers its meaning in plain words (the meanings are in the dictionaries as term.<id>.d).

export type TermId = "cas" | "protector" | "attestation" | "iqama" | "promoter" | "biometrics" | "sponsor";

const PATTERNS: Record<TermId, RegExp> = {
  cas: /\bCAS\b/,
  protector: /protector|پروٹیکٹر/i,
  attestation: /attest|اٹیسٹیشن/i,
  iqama: /iqama|اقامہ/i,
  promoter: /promoter|پروموٹر/i,
  biometrics: /biometric|بائیومیٹرک/i,
  sponsor: /sponsor|اسپانسر/i,
};

/** The known terms that appear in a piece of text, in a fixed order. */
export function findTerms(text: string): TermId[] {
  return (Object.keys(PATTERNS) as TermId[]).filter((id) => PATTERNS[id].test(text));
}
