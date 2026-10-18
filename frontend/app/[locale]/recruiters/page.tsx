import { titled } from "@/lib/i18n/meta";
import { RecruitersScreen } from "./RecruitersScreen";

export const generateMetadata = titled("rec.title");

export default function Page() {
  return <RecruitersScreen />;
}
