import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ALL_PACKS } from "@/lib/engine/bundled";
import { isTranslated, localized } from "@/lib/engine/packs";
import { UI_LOCALES, isUiLocale } from "@/lib/i18n/config";
import { DocumentGuideScreen } from "./DocumentGuideScreen";

type Params = Promise<{ locale: string; country: string; doc: string }>;

const GUIDE_TEXT = ["title", "summary", "issued_by", "typical_time", "bring", "steps"] as const;

// One static page per guide and language, so a guide opens as plain HTML and can be shared as a link.
export const dynamicParams = false;

export function generateStaticParams() {
  return UI_LOCALES.flatMap((locale) => ALL_PACKS.flatMap((pack) => (pack.documents ?? []).map((d) => ({ locale, country: pack.code.toLowerCase(), doc: d.id }))));
}

function find(country: string, doc: string) {
  const pack = ALL_PACKS.find((p) => p.code.toLowerCase() === country.toLowerCase());
  const guide = pack?.documents?.find((d) => d.id === doc);
  return pack && guide ? { pack, guide } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, country, doc } = await params;
  const found = find(country, doc);
  return found ? { title: localized(found.guide, locale).title } : {};
}

export default async function DocumentGuidePage({ params }: { params: Params }) {
  const { locale, country, doc } = await params;
  const found = find(country, doc);
  if (!found || !isUiLocale(locale)) notFound();
  const guide = localized(found.guide, locale);
  // Which parts are still English in this language, so the page sets them in the right type.
  const english = GUIDE_TEXT.filter((field) => !isTranslated(found.guide, locale, field));
  return <DocumentGuideScreen country={found.pack.code} guide={guide} english={english} />;
}
