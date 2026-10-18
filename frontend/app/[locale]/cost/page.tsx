import { titled } from "@/lib/i18n/meta";
import { CostScreen } from "./CostScreen";

export const generateMetadata = titled("app.cost");

export default function CostPage() {
  return <CostScreen />;
}
