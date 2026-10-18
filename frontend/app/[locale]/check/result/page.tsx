import { Suspense } from "react";
import { titled } from "@/lib/i18n/meta";
import { ResultScreen } from "./ResultScreen";

export const generateMetadata = titled("result.title");

export default function ResultPage() {
  // Which check to show comes from the address (?id=...), which only the browser knows.
  return (
    <Suspense>
      <ResultScreen />
    </Suspense>
  );
}
