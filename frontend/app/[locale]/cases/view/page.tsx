import { Suspense } from "react";
import { titled } from "@/lib/i18n/meta";
import { CaseScreen } from "./CaseScreen";

export const generateMetadata = titled("cases.title");

export default function Page() {
  // Which case to show comes from the address (?id=...), which only the browser knows.
  return (
    <Suspense>
      <CaseScreen />
    </Suspense>
  );
}
