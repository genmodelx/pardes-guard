import { titled } from "@/lib/i18n/meta";
import { InterviewScreen } from "./InterviewScreen";

export const generateMetadata = titled("interview.title");

export default function Page() {
  return <InterviewScreen />;
}
