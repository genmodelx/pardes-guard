import { titled } from "@/lib/i18n/meta";
import { AdminScreen } from "./AdminScreen";

export const generateMetadata = titled("admin.title");

export default function Page() {
  return <AdminScreen />;
}
