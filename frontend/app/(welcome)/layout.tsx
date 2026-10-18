import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { RETURNING_SCRIPT, THEME_SCRIPT } from "@/lib/boot";
import "../globals.css";

export const metadata: Metadata = {
  title: "Pardes Guard",
  description: "Going abroad for work or study? See every step, what it should really cost, and check your agent and papers before you pay.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1613" },
  ],
};

/** The language picker has its own tiny document: no language is chosen yet, so no dictionary is loaded. */
export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT + RETURNING_SCRIPT }} />
        <link rel="preload" href="/fonts/atkinson-hyperlegible-next-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
