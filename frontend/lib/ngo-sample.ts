// Sample data for trying the NGO console as a guest: fictional agents from the sample list, made-up
// phone and account numbers, and two fictional reports. It is written to this phone's own store
// only, and "Delete everything" removes it like any other data.

import { makeSignal } from "@/lib/engine/network";
import type { DataStore } from "@/lib/store";

/** A made-up layout fingerprint that two of the sample reports share. */
export const SAMPLE_LAYOUT = "a5".repeat(32);

export async function addNgoSamples(store: DataStore): Promise<void> {
  const signals = await Promise.all([
    makeSignal({ caseId: "sample_case_1", license: "FIC1006FSD", name: "Northstar Employment Promoters (Fictional)", phones: ["+92 300 0000101"], accounts: ["PK00FICT0000000000000101"], layouts: [SAMPLE_LAYOUT], fraud: true }),
    makeSignal({ caseId: "sample_case_2", license: "FIC1004KHI", name: "Harbour Gate Placements (Fictional)", phones: ["+92 300 0000101"], accounts: ["PK00FICT0000000000000202"], layouts: [SAMPLE_LAYOUT], fraud: true }),
    makeSignal({ caseId: "sample_case_3", name: "Gulf Link Visa Services (Fictional)", phones: ["+92 300 0000303"], accounts: ["PK00FICT0000000000000202"], fraud: true }),
    makeSignal({ caseId: "sample_case_4", license: "FIC1004KHI", name: "Harbour Gate Placements (Fictional)", accounts: ["PK00FICT0000000000000202"], employer: "Al Noor Fictional Transport Co.", wageProblem: true }),
    makeSignal({ caseId: "sample_case_5", license: "FIC1001LHR", name: "Sunrise Manpower Promoters (Fictional)" }),
  ]);
  for (const signal of signals) await store.addSignal(signal);
  await store.addReport({
    kind: "recruiter",
    recruiter_license: "FIC1006FSD",
    recruiter_name: "Northstar Employment Promoters (Fictional)",
    text: "Sample report. The agent kept my passport and asked for 150,000 rupees more before the visa would come.",
  });
  await store.addReport({
    kind: "scam",
    text: "Sample report. A WhatsApp number offered UK student visas with guaranteed approval for a fee.",
  });
}
