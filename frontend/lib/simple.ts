// Simple mode: bigger text and fewer choices per screen. The choice lives in this browser
// (pg.simple) because it is about how the app looks, like the theme. The boot script sets
// data-simple on <html> before the first paint; this hook reads and changes that attribute.

import { useSyncExternalStore } from "react";
import { SIMPLE_STORAGE_KEY } from "@/lib/boot";
import { writeLocal } from "@/lib/storage";

const EVENT = "pg-simple";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

const read = () => document.documentElement.getAttribute("data-simple") === "on";

export function setSimpleMode(on: boolean): void {
  writeLocal(SIMPLE_STORAGE_KEY, on);
  if (on) document.documentElement.setAttribute("data-simple", "on");
  else document.documentElement.removeAttribute("data-simple");
  window.dispatchEvent(new Event(EVENT));
}

/** True in simple mode. The static HTML is built with everything shown; the hidden parts go after load. */
export function useSimpleMode(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
