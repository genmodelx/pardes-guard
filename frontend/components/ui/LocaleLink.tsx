"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";
import { useI18n } from "@/lib/i18n";
import styles from "./LocaleLink.module.css";

type Props = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  /** An app path without the language prefix, for example "/journey". */
  href: string;
  /**
   * Download the next screen ahead of the tap, so it opens at once. Off by default: on a weak,
   * metered connection a screen should not fetch every page it links to. Switched on only for the
   * bottom bar, SOS and a screen's one primary action.
   */
  prefetch?: boolean;
};

/**
 * Shown while the tapped link's screen is still downloading: a thin bar across the top of the
 * screen. It waits a moment before appearing, so a fast tap shows nothing at all.
 */
function Pending() {
  const { pending } = useLinkStatus();
  const { t } = useI18n();
  return pending ? <span className={styles.pending} role="status" aria-label={t("common.loading")} /> : null;
}

/** A link inside the app. Adds the current language prefix, so screens never build URLs by hand. */
export function LocaleLink({ href, prefetch = false, children, ...rest }: Props) {
  const { href: toLocale } = useI18n();
  return (
    <Link href={toLocale(href)} prefetch={prefetch ? null : false} {...rest}>
      {children}
      <Pending />
    </Link>
  );
}
