import { titled } from "@/lib/i18n/meta";
import { DatesScreen } from "./DatesScreen";

export const generateMetadata = titled("dates.title");

export default function Page() {
  return <DatesScreen />;
}
