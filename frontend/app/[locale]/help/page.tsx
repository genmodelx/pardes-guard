import { titled } from "@/lib/i18n/meta";
import { Help } from "./Help";

export const generateMetadata = titled("help.title");

export default function HelpPage() {
  return <Help />;
}
