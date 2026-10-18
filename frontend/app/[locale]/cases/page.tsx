import { titled } from "@/lib/i18n/meta";
import { CasesScreen } from "./CasesScreen";

export const generateMetadata = titled("cases.title");

export default function Page() {
  return <CasesScreen />;
}
