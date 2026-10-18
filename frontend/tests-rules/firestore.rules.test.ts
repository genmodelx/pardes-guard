// The access table from the build brief, checked against ../firestore.rules in the Firestore emulator.
//
//   npm run test:rules
//
// Each test names the row of the table it proves. `ali` and `bina` are ordinary signed-in users,
// `ngo` is staff (roles/ngo exists with role 'ngo'), and `anon` is not signed in.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-pardes-guard",
    firestore: { rules: readFileSync(join(__dirname, "..", "..", "firestore.rules"), "utf8") },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  // Seed what the tests read, bypassing the rules.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "roles/ngo"), { role: "ngo" });
    await setDoc(doc(db, "roles/boss"), { role: "admin" });
    await setDoc(doc(db, "roles/fake"), { role: "worker" });
    await setDoc(doc(db, "checks/chk_ali"), { owner_id: "ali", level: "red" });
    await setDoc(doc(db, "cases/case_ali"), { owner_id: "ali", title: "Wage short" });
    await setDoc(doc(db, "evidence/ev_ali"), { owner_id: "ali", index: 0 });
    await setDoc(doc(db, "journeys/ali"), { owner_id: "ali", journey: null });
    await setDoc(doc(db, "ratings/LIC1_ali"), { license_no: "LIC1", uid: "ali", stars: 2 });
    await setDoc(doc(db, "signals/sig_ali"), { owner_id: "ali", phones: [] });
    await setDoc(doc(db, "reports/rep_ali"), { owner_id: "ali", status: "pending", text: "x" });
    await setDoc(doc(db, "shares/ABCDEFGHJKLMNP"), { owner_id: "ali", case_id: "case_ali", view: { title: "Wage short" } });
    await setDoc(doc(db, "riskIndex/lic_LIC1"), { risk: 0.8 });
    await setDoc(doc(db, "packOverrides/SA"), { routes: {} });
    await setDoc(doc(db, "config/app"), { notice: "" });
    await setDoc(doc(db, "contentDrafts/d1"), { status: "pending" });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe("checks, cases, evidence: owner or staff read, owner writes", () => {
  for (const [name, path] of [
    ["checks", "checks/chk_ali"],
    ["cases", "cases/case_ali"],
    ["evidence", "evidence/ev_ali"],
  ] as const) {
    it(`${name}: the owner and staff can read; others and signed-out users cannot`, async () => {
      await assertSucceeds(getDoc(doc(as("ali"), path)));
      await assertSucceeds(getDoc(doc(as("ngo"), path)));
      await assertSucceeds(getDoc(doc(as("boss"), path)));
      await assertFails(getDoc(doc(as("bina"), path)));
      await assertFails(getDoc(doc(as("fake"), path))); // a roles document that does not say ngo or admin
      await assertFails(getDoc(doc(anon(), path)));
    });

    it(`${name}: a person can list only their own`, async () => {
      await assertSucceeds(getDocs(query(collection(as("ali"), name), where("owner_id", "==", "ali"))));
      await assertFails(getDocs(collection(as("ali"), name)));
      await assertFails(getDocs(query(collection(as("bina"), name), where("owner_id", "==", "ali"))));
      await assertSucceeds(getDocs(collection(as("ngo"), name)));
    });

    it(`${name}: nobody can create a document in someone else's name`, async () => {
      await assertFails(setDoc(doc(as("bina"), `${name}/new1`), { owner_id: "ali" }));
      await assertFails(setDoc(doc(anon(), `${name}/new2`), { owner_id: "ali" }));
      await assertFails(setDoc(doc(as("ngo"), `${name}/new3`), { owner_id: "ali" })); // staff read, they do not write
    });

    it(`${name}: only the owner can delete`, async () => {
      await assertFails(deleteDoc(doc(as("bina"), path)));
      await assertFails(deleteDoc(doc(as("ngo"), path)));
      await assertSucceeds(deleteDoc(doc(as("ali"), path)));
    });

    it(`${name}: a missing document reads as missing, not as forbidden`, async () => {
      await assertSucceeds(getDoc(doc(as("bina"), `${name}/does-not-exist`)));
      await assertFails(getDoc(doc(anon(), `${name}/does-not-exist`)));
    });
  }

  it("checks and cases: the owner can create and update, and cannot hand a document to someone else", async () => {
    await assertSucceeds(setDoc(doc(as("ali"), "checks/chk_new"), { owner_id: "ali", level: "green" }));
    await assertSucceeds(updateDoc(doc(as("ali"), "checks/chk_ali"), { cleared_at: "2026-10-13T00:00:00Z" }));
    await assertFails(updateDoc(doc(as("ali"), "checks/chk_ali"), { owner_id: "bina" }));
    await assertFails(updateDoc(doc(as("bina"), "cases/case_ali"), { title: "changed" }));
  });

  it("evidence: created only with the server's own time, and never edited", async () => {
    await assertSucceeds(setDoc(doc(as("ali"), "evidence/ev_new"), { owner_id: "ali", index: 1, server_time: serverTimestamp() }));
    await assertFails(setDoc(doc(as("ali"), "evidence/ev_backdated"), { owner_id: "ali", index: 2, server_time: new Date("2020-01-01") }));
    await assertFails(setDoc(doc(as("ali"), "evidence/ev_untimed"), { owner_id: "ali", index: 3 }));
    await assertFails(updateDoc(doc(as("ali"), "evidence/ev_ali"), { sha256: "tampered" }));
  });
});

describe("journeys/{uid}: owner or staff read, owner writes", () => {
  it("a person reads and writes only their own record", async () => {
    await assertSucceeds(getDoc(doc(as("ali"), "journeys/ali")));
    await assertSucceeds(getDoc(doc(as("bina"), "journeys/bina"))); // not created yet: reads as missing
    await assertFails(getDoc(doc(as("bina"), "journeys/ali")));
    await assertFails(getDoc(doc(anon(), "journeys/ali")));
    await assertSucceeds(getDoc(doc(as("ngo"), "journeys/ali")));

    await assertSucceeds(setDoc(doc(as("bina"), "journeys/bina"), { owner_id: "bina", journey: null }));
    await assertFails(setDoc(doc(as("bina"), "journeys/ali"), { owner_id: "bina" }));
    await assertFails(setDoc(doc(as("bina"), "journeys/bina"), { owner_id: "ali" }));
    await assertFails(setDoc(doc(as("ngo"), "journeys/ali"), { owner_id: "ali" }));
    await assertFails(deleteDoc(doc(as("bina"), "journeys/ali")));
    await assertSucceeds(deleteDoc(doc(as("ali"), "journeys/ali")));
  });

  it("only staff can list every record", async () => {
    await assertFails(getDocs(collection(as("ali"), "journeys")));
    await assertSucceeds(getDocs(collection(as("ngo"), "journeys")));
  });
});

describe("ratings/{license}_{uid}: signed-in users read, that uid writes", () => {
  it("any signed-in user reads; signed-out users do not", async () => {
    await assertSucceeds(getDoc(doc(as("bina"), "ratings/LIC1_ali")));
    await assertSucceeds(getDocs(query(collection(as("bina"), "ratings"), where("license_no", "==", "LIC1"))));
    await assertFails(getDoc(doc(anon(), "ratings/LIC1_ali")));
  });

  it("a person writes only the rating whose id carries their own uid, with 1 to 5 whole stars", async () => {
    await assertSucceeds(setDoc(doc(as("bina"), "ratings/LIC1_bina"), { license_no: "LIC1", uid: "bina", stars: 5 }));
    await assertSucceeds(setDoc(doc(as("ali"), "ratings/LIC1_ali"), { license_no: "LIC1", uid: "ali", stars: 4 }));
    await assertFails(setDoc(doc(as("bina"), "ratings/LIC1_ali"), { license_no: "LIC1", uid: "ali", stars: 5 }));
    await assertFails(setDoc(doc(as("bina"), "ratings/LIC1_ali"), { license_no: "LIC1", uid: "bina", stars: 5 }));
    await assertFails(setDoc(doc(as("bina"), "ratings/LIC2_bina"), { license_no: "LIC1", uid: "bina", stars: 5 }));
    await assertFails(setDoc(doc(as("bina"), "ratings/LIC1_bina"), { license_no: "LIC1", uid: "bina", stars: 6 }));
    await assertFails(setDoc(doc(as("bina"), "ratings/LIC1_bina"), { license_no: "LIC1", uid: "bina", stars: 0 }));
    await assertFails(setDoc(doc(as("bina"), "ratings/LIC1_bina"), { license_no: "LIC1", uid: "bina", stars: 4.5 }));
    await assertFails(deleteDoc(doc(as("bina"), "ratings/LIC1_ali")));
    await assertSucceeds(deleteDoc(doc(as("ali"), "ratings/LIC1_ali")));
  });
});

describe("signals: staff read; a signed-in user creates their own and can delete it", () => {
  it("the author cannot read signals back, others cannot read at all, staff can", async () => {
    await assertFails(getDoc(doc(as("ali"), "signals/sig_ali")));
    await assertFails(getDocs(query(collection(as("ali"), "signals"), where("owner_id", "==", "ali"))));
    await assertFails(getDoc(doc(as("bina"), "signals/sig_ali")));
    await assertSucceeds(getDoc(doc(as("ngo"), "signals/sig_ali")));
    await assertSucceeds(getDocs(collection(as("ngo"), "signals")));
  });

  it("create needs owner_id == uid; nobody edits; the owner deletes", async () => {
    await assertSucceeds(setDoc(doc(as("bina"), "signals/sig_bina"), { owner_id: "bina", phones: ["ph_x"] }));
    await assertFails(setDoc(doc(as("bina"), "signals/sig_forged"), { owner_id: "ali", phones: [] }));
    await assertFails(setDoc(doc(anon(), "signals/sig_anon"), { owner_id: "x", phones: [] }));
    await assertFails(updateDoc(doc(as("ali"), "signals/sig_ali"), { fraud: true }));
    await assertFails(deleteDoc(doc(as("bina"), "signals/sig_ali")));
    await assertSucceeds(deleteDoc(doc(as("ali"), "signals/sig_ali")));
  });
});

describe("reports: staff read; a signed-in user creates", () => {
  it("reports are never readable by the public, including their author", async () => {
    await assertFails(getDoc(doc(as("ali"), "reports/rep_ali")));
    await assertFails(getDoc(doc(as("bina"), "reports/rep_ali")));
    await assertFails(getDoc(doc(anon(), "reports/rep_ali")));
    await assertSucceeds(getDoc(doc(as("ngo"), "reports/rep_ali")));
  });

  it("a signed-in user creates a pending report in their own name; staff review it", async () => {
    await assertSucceeds(setDoc(doc(as("bina"), "reports/rep_bina"), { owner_id: "bina", status: "pending", text: "fake advert" }));
    await assertFails(setDoc(doc(as("bina"), "reports/rep_pre"), { owner_id: "bina", status: "approved", text: "self-approved" }));
    await assertFails(setDoc(doc(as("bina"), "reports/rep_forged"), { owner_id: "ali", status: "pending", text: "x" }));
    await assertFails(setDoc(doc(anon(), "reports/rep_anon"), { owner_id: "x", status: "pending", text: "x" }));
    await assertFails(updateDoc(doc(as("ali"), "reports/rep_ali"), { status: "approved" }));
    await assertSucceeds(updateDoc(doc(as("ngo"), "reports/rep_ali"), { status: "approved" }));
    await assertSucceeds(deleteDoc(doc(as("ali"), "reports/rep_ali")));
  });
});

describe("shares/{code}: get by anyone, no list, written by the case owner", () => {
  it("anyone with the code can open it, signed in or not; nobody can list codes", async () => {
    await assertSucceeds(getDoc(doc(anon(), "shares/ABCDEFGHJKLMNP")));
    await assertSucceeds(getDoc(doc(as("bina"), "shares/ABCDEFGHJKLMNP")));
    await assertFails(getDocs(collection(anon(), "shares")));
    await assertFails(getDocs(collection(as("ali"), "shares")));
    await assertFails(getDocs(collection(as("ngo"), "shares")));
    await assertFails(getDocs(query(collection(as("ali"), "shares"), where("owner_id", "==", "ali"))));
  });

  it("only the owner of the case can create, change or remove its share", async () => {
    await assertSucceeds(setDoc(doc(as("ali"), "shares/QRSTUVWXYZ234567"), { owner_id: "ali", case_id: "case_ali", view: {} }));
    await assertFails(setDoc(doc(as("bina"), "shares/BINASHARECODE12"), { owner_id: "bina", case_id: "case_ali", view: {} }));
    await assertFails(setDoc(doc(as("ali"), "shares/short"), { owner_id: "ali", case_id: "case_ali", view: {} }));
    await assertFails(setDoc(doc(as("ali"), "shares/NOSUCHCASECODE1"), { owner_id: "ali", case_id: "missing", view: {} }));
    await assertFails(updateDoc(doc(as("bina"), "shares/ABCDEFGHJKLMNP"), { view: { title: "hijacked" } }));
    await assertSucceeds(updateDoc(doc(as("ali"), "shares/ABCDEFGHJKLMNP"), { view: { title: "Wage short, step 2" } }));
    await assertFails(updateDoc(doc(as("ali"), "shares/ABCDEFGHJKLMNP"), { case_id: "another" }));
    await assertFails(deleteDoc(doc(as("bina"), "shares/ABCDEFGHJKLMNP")));
    await assertSucceeds(deleteDoc(doc(as("ali"), "shares/ABCDEFGHJKLMNP")));
  });
});

describe("riskIndex, packOverrides, config: anyone reads, staff write", () => {
  for (const path of ["riskIndex/lic_LIC1", "packOverrides/SA", "config/app"]) {
    it(`${path}: public read, staff-only write`, async () => {
      await assertSucceeds(getDoc(doc(anon(), path)));
      await assertSucceeds(getDoc(doc(as("ali"), path)));
      await assertFails(setDoc(doc(as("ali"), path), { risk: 0 }));
      await assertFails(setDoc(doc(anon(), path), { risk: 0 }));
      await assertFails(setDoc(doc(as("fake"), path), { risk: 0 }));
      await assertSucceeds(setDoc(doc(as("ngo"), path), { risk: 0.9 }));
      await assertSucceeds(setDoc(doc(as("boss"), path), { risk: 0.9 }));
    });
  }
});

describe("config/recruiters: anyone reads, only an admin replaces the licensed list", () => {
  for (const path of ["config/recruiters", "config/recruiters_0", "config/recruiters_12"]) {
    it(`${path}: public read, admin-only write`, async () => {
      await assertSucceeds(getDoc(doc(anon(), path)));
      await assertFails(setDoc(doc(as("ali"), path), { rows: [] }));
      await assertFails(setDoc(doc(as("ngo"), path), { rows: [] }));
      await assertSucceeds(setDoc(doc(as("boss"), path), { rows: [] }));
      await assertFails(deleteDoc(doc(as("ngo"), path)));
      await assertSucceeds(deleteDoc(doc(as("boss"), path)));
    });
  }
  it("a name that only starts like the list is an ordinary setting", async () => {
    await assertSucceeds(setDoc(doc(as("ngo"), "config/fakeLayouts"), { hashes: [] }));
    await assertSucceeds(setDoc(doc(as("ngo"), "config/recruiters_notes"), { text: "" }));
  });
});

describe("contentDrafts: staff only", () => {
  it("staff read and write; nobody else sees drafts", async () => {
    await assertSucceeds(getDoc(doc(as("boss"), "contentDrafts/d1")));
    await assertSucceeds(setDoc(doc(as("ngo"), "contentDrafts/d2"), { status: "pending" }));
    await assertFails(getDoc(doc(as("ali"), "contentDrafts/d1")));
    await assertFails(getDoc(doc(anon(), "contentDrafts/d1")));
    await assertFails(setDoc(doc(as("ali"), "contentDrafts/d3"), { status: "approved" }));
  });
});

describe("roles/{uid}: that uid reads, nobody writes from a client", () => {
  it("a user can read their own role and no one else's", async () => {
    await assertSucceeds(getDoc(doc(as("ngo"), "roles/ngo")));
    await assertSucceeds(getDoc(doc(as("ali"), "roles/ali"))); // missing: simply not staff
    await assertFails(getDoc(doc(as("ali"), "roles/ngo")));
    await assertFails(getDoc(doc(anon(), "roles/ngo")));
    await assertFails(getDocs(collection(as("boss"), "roles")));
  });

  it("no client can grant itself or anyone a role, not even an admin", async () => {
    await assertFails(setDoc(doc(as("ali"), "roles/ali"), { role: "admin" }));
    await assertFails(setDoc(doc(as("boss"), "roles/ali"), { role: "ngo" }));
    await assertFails(updateDoc(doc(as("ngo"), "roles/ngo"), { role: "admin" }));
    await assertFails(deleteDoc(doc(as("boss"), "roles/ngo")));
  });
});

describe("everything else", () => {
  it("a collection the rules do not name is closed", async () => {
    await assertFails(getDoc(doc(as("boss"), "secrets/x")));
    await assertFails(setDoc(doc(as("boss"), "anything/x"), { a: 1 }));
  });
});
