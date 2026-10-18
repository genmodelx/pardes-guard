import { titled } from "@/lib/i18n/meta";
import { ScanScreen } from "./ScanScreen";

export const generateMetadata = titled("app.readiness");

export default function Page() {
  return <ScanScreen />;
}
