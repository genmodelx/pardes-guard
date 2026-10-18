import { Suspense } from "react";
import { titled } from "@/lib/i18n/meta";
import { FamilyScreen } from "./FamilyScreen";

export const generateMetadata = titled("family.title");

export default function Page() {
  // A link may carry the code (?code=...), which only the browser knows.
  return (
    <Suspense>
      <FamilyScreen />
    </Suspense>
  );
}
