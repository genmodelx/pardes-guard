import { titled } from "@/lib/i18n/meta";
import { WageScreen } from "./WageScreen";

export const generateMetadata = titled("wage.title");

export default function Page() {
  return <WageScreen />;
}
