import { Suspense } from "react";
import { titled } from "@/lib/i18n/meta";
import { VaultScreen } from "./VaultScreen";

export const generateMetadata = titled("vault.title");

export default function Page() {
  // A case to add files to may come in the address (?case=...), which only the browser knows.
  return (
    <Suspense>
      <VaultScreen />
    </Suspense>
  );
}
