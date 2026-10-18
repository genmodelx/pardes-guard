import { Suspense } from "react";
import { titled } from "@/lib/i18n/meta";
import { NewCaseScreen } from "./NewCaseScreen";

export const generateMetadata = titled("cases.new");

export default function Page() {
  // A check to start from may come in the address (?check=...), which only the browser knows.
  return (
    <Suspense>
      <NewCaseScreen />
    </Suspense>
  );
}
