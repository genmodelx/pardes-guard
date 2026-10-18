import { Suspense } from "react";
import { titled } from "@/lib/i18n/meta";
import { RecruiterScreen } from "./RecruiterScreen";

export const generateMetadata = titled("rec.title");

export default function Page() {
  // Which agent to show comes from the address (?licence=...), which only the browser knows.
  return (
    <Suspense>
      <RecruiterScreen />
    </Suspense>
  );
}
