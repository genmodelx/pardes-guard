import { titled } from "@/lib/i18n/meta";
import { Documents } from "./Documents";

export const generateMetadata = titled("docs.title");

export default function DocumentsPage() {
  return <Documents />;
}
