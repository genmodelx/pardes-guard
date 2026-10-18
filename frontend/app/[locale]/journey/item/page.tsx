import { Suspense } from "react";
import { titled } from "@/lib/i18n/meta";
import { ItemScreen } from "./ItemScreen";

export const generateMetadata = titled("journey.title");

export default function ItemPage() {
  // Which step to show comes from the address (?id=...), which only the browser knows.
  return (
    <Suspense>
      <ItemScreen />
    </Suspense>
  );
}
