// "Delete everything", without a browser: the store is emptied first, then the files, then the
// browser's own data, then the account. Display choices stay.

import { describe, expect, it } from "vitest";
import { openCase } from "@/lib/engine/cases";
import { newJourney } from "@/lib/engine/journey";
import { clearBrowserData, deleteEverything } from "@/lib/privacy";
import { LocalStore, MemoryStorage } from "@/lib/store-local";

describe("delete everything", () => {
  it("clears the app's browser data but keeps language, theme and simple mode", () => {
    const local = new MemoryStorage();
    const session = new MemoryStorage();
    for (const key of ["pg.db.checks", "pg.guest", "pg.stampsSeen", "pg.locale", "pg.theme", "pg.simple", "other.app"]) local.setItem(key, "x");
    session.setItem("pg.caseDraft.ab12", "{}");
    clearBrowserData(local as unknown as Storage, session as unknown as Storage);
    expect(["pg.locale", "pg.theme", "pg.simple", "other.app"].every((k) => local.getItem(k) === "x")).toBe(true);
    expect(["pg.db.checks", "pg.guest", "pg.stampsSeen"].some((k) => local.getItem(k) !== null)).toBe(false);
    expect(session.getItem("pg.caseDraft.ab12")).toBeNull();
  });

  it("empties the store, then the files and the browser, then deletes the account", async () => {
    const storage = new MemoryStorage();
    const store = new LocalStore("w1", storage);
    await store.saveJourney(newJourney("w1", { purpose: "work", origin: "PK", destination: "SA", route_id: "sa-work" }));
    await store.saveCase(openCase("w1", { kind: "other", title: "x", summary: "y" }).case);
    const order: string[] = [];
    const result = await deleteEverything({
      store,
      files: async () => void order.push("files"),
      browser: () => void order.push("browser"),
      deleteAccount: async () => {
        order.push("account");
        return "ok";
      },
    });
    expect(result).toBe("done");
    expect(order).toEqual(["files", "browser", "account"]);
    expect(await store.listCases()).toEqual([]);
    expect(await store.getJourney()).toBeNull();
  });

  it("stops before touching the account when the store cannot be emptied, and passes on a needed sign-in", async () => {
    const store = new LocalStore("w1", new MemoryStorage());
    const failing = Object.assign(Object.create(store), { deleteEverything: async () => Promise.reject(new Error("offline")) });
    let accountTouched = false;
    const deleteAccount = async () => {
      accountTouched = true;
      return "needs-recent-login" as const;
    };
    expect(await deleteEverything({ store: failing, deleteAccount, files: async () => undefined, browser: () => undefined })).toBe("failed");
    expect(accountTouched).toBe(false);
    expect(await deleteEverything({ store, deleteAccount, files: async () => undefined, browser: () => undefined })).toBe("needs-recent-login");
  });
});
