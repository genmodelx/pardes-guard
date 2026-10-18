import { titled } from "@/lib/i18n/meta";
import { Sos } from "./Sos";

export const generateMetadata = titled("sos.title");

export default function SosPage() {
  return <Sos />;
}
