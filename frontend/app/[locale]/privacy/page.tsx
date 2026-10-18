import { titled } from "@/lib/i18n/meta";
import { PrivacyScreen } from "./PrivacyScreen";

export const generateMetadata = titled("privacy.title");

export default function Page() {
  return <PrivacyScreen />;
}
