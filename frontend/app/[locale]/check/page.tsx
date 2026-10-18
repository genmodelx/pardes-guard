import { titled } from "@/lib/i18n/meta";
import { CheckScreen } from "./CheckScreen";

export const generateMetadata = titled("check.title");

export default function CheckPage() {
  return <CheckScreen />;
}
