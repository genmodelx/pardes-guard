import { titled } from "@/lib/i18n/meta";
import { Home } from "./Home";

export const generateMetadata = titled("common.home");

export default function HomePage() {
  return <Home />;
}
