"use client";

// The person's data, ready for screens: which store they are on, their journey, and the plan and
// progress built from it. Lives above the pages, so moving between Home, Journey and a step does
// not load anything twice.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { buildPlan, changeAnswers, newJourney, progress as computeProgress, setItemStatus, syncStages, type ItemStatus, type Journey, type JourneyAnswers, type JourneyPlan, type Progress } from "@/lib/engine/journey";
import { advanceCases, casesWaiting as waitingOf } from "@/lib/case-timers";
import { setRecruiterSource } from "@/lib/recruiter-list";
import { checkPassport, localToday, type PassportCheck } from "@/lib/engine/readiness";
import { useI18n } from "@/lib/i18n";
import { PACK_INDEX, loadPack } from "@/lib/packs";
import { DEFAULT_SETTINGS, openRedList, type DataStore, type Readiness, type UserSettings } from "@/lib/store";
import { LocalStore, deviceStorage } from "@/lib/store-local";
import type { CountryPack } from "@/lib/types";

// ---- Store -----------------------------------------------------------------------------------------

interface StoreState {
  /** null until we know who the user is and their store is open. */
  store: DataStore | null;
  /** False when the browser cannot keep data (private mode): the guest's journey lasts until the tab closes. */
  persistent: boolean;
  /** True when the account's store could not be opened (offline before the SDK was cached). */
  failed: boolean;
  /** Try to open the store again. */
  retry: () => void;
}

const StoreContext = createContext<StoreState>({ store: null, persistent: true, failed: false, retry: () => undefined });

/** Bring a guest's journey along when they sign in for the first time, so their ticks are not lost. */
async function adoptGuestJourney(account: DataStore, guest: DataStore): Promise<void> {
  if (await account.getJourney()) return;
  const local = await guest.getJourney();
  if (local) await account.saveJourney({ ...local, owner_id: account.uid });
}

/**
 * An imported licensed list is read through whichever store is open. Set before the store reaches the
 * screens: a screen's effect runs before this provider's own effects, so setting it in an effect of
 * its own would let the first screen read the sample list.
 */
function readListThrough(store: DataStore | null): void {
  setRecruiterSource(store ? () => store.getRecruiterList() : null);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const { ready, user } = useAuth();
  const [state, setState] = useState<Pick<StoreState, "store" | "persistent" | "failed">>({ store: null, persistent: true, failed: false });
  const [attempt, setAttempt] = useState(0);
  const lastGuest = useRef<DataStore | null>(null);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    if (user.guest) {
      const { storage, persistent } = deviceStorage();
      const store = new LocalStore(user.uid, storage);
      lastGuest.current = store;
      readListThrough(store);
      setState({ store, persistent, failed: false });
      return;
    }
    readListThrough(null);
    setState({ store: null, persistent: true, failed: false });
    (async () => {
      const { openFirestoreStore } = await import("@/lib/store-firestore");
      const store = await openFirestoreStore(user.uid);
      if (lastGuest.current) await adoptGuestJourney(store, lastGuest.current).catch(() => undefined);
      if (cancelled) return;
      readListThrough(store);
      setState({ store, persistent: true, failed: false });
    })().catch(() => {
      // The account's store could not be opened (offline before the SDK was cached). Screens show
      // their load error with a retry; nothing is written anywhere else in the meantime.
      if (!cancelled) setState({ store: null, persistent: true, failed: true });
    });
    return () => {
      cancelled = true;
    };
  }, [ready, user.uid, user.guest, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const value = useMemo<StoreState>(() => ({ ...state, retry }), [state, retry]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreState {
  return useContext(StoreContext);
}

// ---- Journey ---------------------------------------------------------------------------------------

export interface JourneyState {
  /** loading: not known yet. none: the person has not answered the start questions. */
  status: "loading" | "none" | "ready" | "error";
  journey: Journey | null;
  plan: JourneyPlan | null;
  progress: Progress | null;
  origin: CountryPack | null;
  destination: CountryPack | null;
  /** Set when the last save did not reach the store. The screen shows it with a retry. */
  saveFailed: boolean;
  /** The person's newest check that still carries a red stamp. */
  openRed: { count: number; latest: string | null };
  /** What the readiness scan found, as saved. */
  readiness: Readiness | null;
  /** The saved passport's dates against the route's rule; null until a passport has been scanned. */
  passport: PassportCheck | null;
  /** Cases with a letter waiting for the person's approval, newest first. */
  casesWaiting: { count: number; latest: { id: string; title: string } | null };
  /** The person's settings: the AI answer language and whether to share fraud signals. */
  settings: UserSettings;
  start: (answers: JourneyAnswers) => Promise<boolean>;
  setStatus: (itemId: string, status: ItemStatus) => Promise<boolean>;
  reload: () => void;
  /** Re-read the person's checks (after a new check, or clearing a red one) without reloading the journey. */
  refreshChecks: () => Promise<void>;
  /** Save (or, with null, delete) the readiness results. False when the save did not reach the store. */
  saveReadiness: (readiness: Readiness | null) => Promise<boolean>;
  /** Re-read the person's cases after a change. */
  refreshCases: () => Promise<void>;
  /** Change some settings. False when the save did not reach the store. */
  saveSettings: (patch: Partial<UserSettings>) => Promise<boolean>;
}

const JourneyContext = createContext<JourneyState | null>(null);

export function JourneyProvider({ children }: { children: ReactNode }) {
  const { store, failed: storeFailed, retry: retryStore } = useStore();
  const { locale } = useI18n();
  const [status, setStatusState] = useState<JourneyState["status"]>("loading");
  const [journey, setJourney] = useState<Journey | null>(null);
  const [packs, setPacks] = useState<{ origin: CountryPack | null; destination: CountryPack | null }>({ origin: null, destination: null });
  const [red, setRed] = useState<{ count: number; latest: string | null }>({ count: 0, latest: null });
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [casesWaiting, setCasesWaiting] = useState<JourneyState["casesWaiting"]>({ count: 0, latest: null });
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [saveFailed, setSaveFailed] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!store) {
      setStatusState(storeFailed ? "error" : "loading");
      return;
    }
    let cancelled = false;
    setStatusState("loading");
    (async () => {
      const [user, checks, cases] = await Promise.all([store.getUser(), store.listChecks().catch(() => []), advanceCases(store)]);
      const saved = user.journey;
      const [origin, destination] = saved ? await Promise.all([loadPack(saved.answers.origin), loadPack(saved.answers.destination)]) : [null, null];
      if (cancelled) return;
      setJourney(saved);
      setReadiness(user.readiness);
      setSettings(user.settings);
      setCasesWaiting(waitingOf(cases));
      setPacks({ origin, destination });
      const open = openRedList(checks);
      setRed({ count: open.length, latest: open[0]?.check_id ?? null });
      setSaveFailed(false);
      setStatusState(saved ? "ready" : "none");
    })().catch(() => {
      if (!cancelled) setStatusState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [store, storeFailed, tick]);

  const plan = useMemo(() => (journey ? buildPlan(journey.answers, packs.origin, packs.destination, PACK_INDEX, locale) : null), [journey, packs, locale]);
  const passport = useMemo(() => {
    if (!readiness?.papers.some((p) => p.kind === "passport")) return null;
    const route = packs.destination?.visa_routes.find((r) => r.id === journey?.answers.route_id) ?? null;
    return checkPassport(readiness.papers, route, localToday());
  }, [readiness, packs.destination, journey?.answers.route_id]);
  const progress = useMemo(() => (plan ? computeProgress(plan, journey, red.count) : null), [plan, journey, red.count]);

  const persist = useCallback(
    async (next: Journey, previous: Journey | null): Promise<boolean> => {
      if (!store) return false;
      setJourney(next); // show the change at once; undo it if the save fails
      try {
        await store.saveJourney(next);
        setSaveFailed(false);
        return true;
      } catch {
        setJourney(previous);
        setSaveFailed(true);
        return false;
      }
    },
    [store],
  );

  const start = useCallback(
    async (answers: JourneyAnswers): Promise<boolean> => {
      if (!store) return false;
      const [origin, destination] = await Promise.all([loadPack(answers.origin), loadPack(answers.destination)]);
      const base = journey ? changeAnswers(journey, answers) : newJourney(store.uid, answers);
      const next = syncStages(base, buildPlan(answers, origin, destination, PACK_INDEX, locale));
      setPacks({ origin, destination });
      const ok = await persist(next, journey);
      if (ok) setStatusState("ready");
      return ok;
    },
    [store, journey, locale, persist],
  );

  const setStatus = useCallback(
    async (itemId: string, itemStatus: ItemStatus): Promise<boolean> => {
      if (!journey || !plan) return false;
      return persist(setItemStatus(journey, plan, itemId, itemStatus), journey);
    },
    [journey, plan, persist],
  );

  const reload = useCallback(() => {
    if (store) setTick((n) => n + 1);
    else retryStore();
  }, [store, retryStore]);

  const refreshChecks = useCallback(async () => {
    if (!store) return;
    const open = openRedList(await store.listChecks().catch(() => []));
    setRed({ count: open.length, latest: open[0]?.check_id ?? null });
  }, [store]);

  const saveReadiness = useCallback(
    async (next: Readiness | null): Promise<boolean> => {
      if (!store) return false;
      try {
        await store.saveReadiness(next);
        setReadiness(next);
        return true;
      } catch {
        return false;
      }
    },
    [store],
  );

  const refreshCases = useCallback(async () => {
    if (!store) return;
    setCasesWaiting(waitingOf(await store.listCases().catch(() => [])));
  }, [store]);

  const saveSettings = useCallback(
    async (patch: Partial<UserSettings>): Promise<boolean> => {
      if (!store) return false;
      try {
        setSettings(await store.saveSettings(patch));
        return true;
      } catch {
        return false;
      }
    },
    [store],
  );

  const value = useMemo<JourneyState>(
    () => ({ status, journey, plan, progress, origin: packs.origin, destination: packs.destination, saveFailed, openRed: red, readiness, passport, casesWaiting, settings, start, setStatus, reload, refreshChecks, saveReadiness, refreshCases, saveSettings }),
    [status, journey, plan, progress, packs, saveFailed, red, readiness, passport, casesWaiting, settings, start, setStatus, reload, refreshChecks, saveReadiness, refreshCases, saveSettings],
  );
  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export function useJourney(): JourneyState {
  const ctx = useContext(JourneyContext);
  if (!ctx) throw new Error("useJourney must be used inside JourneyProvider");
  return ctx;
}
