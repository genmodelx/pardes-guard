"use client";

// The recruiter list for a screen: waits until the person's store is open (an imported official list
// is read through it), and loads again when the store changes, for example after signing in.

import { useEffect, useState } from "react";
import { useStore } from "@/lib/data";
import type { RecruiterDirectory } from "@/lib/engine/recruiters";
import { recruiterDirectory } from "@/lib/recruiter-list";

export function useDirectory(): { directory: RecruiterDirectory | null; failed: boolean; retry: () => void } {
  const { store, failed: storeFailed } = useStore();
  const [directory, setDirectory] = useState<RecruiterDirectory | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // With no store at all (it could not be opened), the bundled list still answers.
  const waiting = !store && !storeFailed;
  useEffect(() => {
    if (waiting) return;
    let cancelled = false;
    setFailed(false);
    recruiterDirectory()
      .then((d) => !cancelled && setDirectory(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [waiting, store, attempt]);
  return { directory, failed, retry: () => setAttempt((n) => n + 1) };
}
