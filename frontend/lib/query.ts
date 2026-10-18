"use client";

import { useSearchParams } from "next/navigation";

/**
 * One value from the address bar's query string (the id in /journey/item?id=...).
 * The pages are static files, so ids travel in the query string. A page that uses this wraps its
 * screen in <Suspense>, because the value is only known in the browser.
 */
export function useQueryParam(name: string): string | null {
  return useSearchParams().get(name);
}
