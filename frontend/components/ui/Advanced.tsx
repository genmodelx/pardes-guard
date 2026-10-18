"use client";

import type { ReactNode } from "react";
import { useSimpleMode } from "@/lib/simple";

/** A tool most people rarely need. Hidden in simple mode, so a screen keeps at most three choices. */
export function Advanced({ children }: { children: ReactNode }) {
  return useSimpleMode() ? null : <>{children}</>;
}
