import { titled } from "@/lib/i18n/meta";
import { AssistantScreen } from "./AssistantScreen";

export const generateMetadata = titled("assistant.title");

export default function Page() {
  return <AssistantScreen />;
}
