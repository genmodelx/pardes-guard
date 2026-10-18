import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { InkFilters } from "@/components/ui/Stamp";
import { THEME_SCRIPT } from "@/lib/boot";
import { isUiLocale, languageInfo, SCRIPT_FONT, UI_LOCALES } from "@/lib/i18n/config";
import { dictionaryFor } from "@/lib/i18n/dictionaries";
import fontFiles from "@/lib/i18n/font-files.json";
import { Providers } from "../providers";
import "../globals.css";

type Params = Promise<{ locale: string }>;

// Every interface language is a real folder of static pages (/ur/..., /en/...), so the HTML a phone
// receives is already in the right language and direction before any script runs.
export const dynamicParams = false;

export function generateStaticParams() {
  return UI_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params;
  if (!isUiLocale(locale)) return {};
  const dict = dictionaryFor(locale);
  return {
    title: { default: dict.brand, template: `%s | ${dict.brand}` },
    description: dict["meta.description"],
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon.svg", apple: "/icon-192.png" },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1613" },
  ],
};

const fontUrl = (family: string): string | null => {
  const subsets = (fontFiles as Record<string, Record<string, string>>)[family];
  return subsets ? Object.values(subsets)[0] : null;
};

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Params }) {
  const { locale } = await params;
  if (!isUiLocale(locale)) notFound();
  const info = languageInfo(locale);
  const scriptFamily = SCRIPT_FONT[info.script];
  const preload = [fontUrl("Atkinson Hyperlegible Next"), fontUrl("Pardes Zero"), scriptFamily ? fontUrl(scriptFamily) : null].filter((u): u is string => Boolean(u));

  return (
    <html lang={locale} dir={info.dir} suppressHydrationWarning>
      <head>
        {/* Theme and simple mode are applied before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {preload.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body>
        <Providers locale={locale} dict={dictionaryFor(locale)}>
          {children}
        </Providers>
        <InkFilters />
      </body>
    </html>
  );
}
