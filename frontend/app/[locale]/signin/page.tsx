import { titled } from "@/lib/i18n/meta";
import { SignIn } from "./SignIn";

export const generateMetadata = titled("common.signin");

export default function SignInPage() {
  return <SignIn />;
}
