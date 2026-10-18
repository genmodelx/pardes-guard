import { titled } from "@/lib/i18n/meta";
import { More } from "./More";

export const generateMetadata = titled("more.title");

export default function MorePage() {
  return <More />;
}
