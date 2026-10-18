import { titled } from "@/lib/i18n/meta";
import { EligibilityScreen } from "./EligibilityScreen";

export const generateMetadata = titled("elig.title");

export default function Page() {
  return <EligibilityScreen />;
}
