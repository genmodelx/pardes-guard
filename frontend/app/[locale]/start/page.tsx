import { Suspense } from "react";
import { titled } from "@/lib/i18n/meta";
import { Start } from "./Start";

export const generateMetadata = titled("home.start.title");

export default function StartPage() {
  // The question number lives in the address (?q=2), so the phone's Back button goes to the
  // previous question. It is only known in the browser, hence the Suspense boundary.
  return (
    <Suspense>
      <Start />
    </Suspense>
  );
}
