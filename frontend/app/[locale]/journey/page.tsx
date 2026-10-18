import { titled } from "@/lib/i18n/meta";
import { JourneyScreen } from "./JourneyScreen";

export const generateMetadata = titled("journey.title");

export default function JourneyPage() {
  return <JourneyScreen />;
}
