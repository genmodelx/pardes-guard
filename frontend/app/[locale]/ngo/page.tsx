import { titled } from "@/lib/i18n/meta";
import { NgoScreen } from "./NgoScreen";

export const generateMetadata = titled("ngo.title");

export default function Page() {
  return <NgoScreen />;
}
