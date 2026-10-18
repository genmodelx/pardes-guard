"use client";

import { LANGUAGES, LOCALE_STORAGE_KEY, UI_LOCALES, isMachine, type LanguageInfo } from "@/lib/i18n/config";
import { writeLocal } from "@/lib/storage";
import styles from "./LanguageLinks.module.css";

/**
 * The language choices, each written in its own script. They are plain links to that language's
 * pages, so they work before any script has loaded; the click also remembers the choice.
 * Other languages are drawn with the phone's own fonts, so this list downloads no web font. A
 * language drafted by machine says so, in that language.
 */
export function LanguageLinks({ to, current }: { to: string; current?: string }) {
  const path = to.replace(/^\/+|\/+$/g, "");
  return (
    <ul className={styles.list}>
      {UI_LOCALES.map((code) => {
        const info: LanguageInfo = LANGUAGES[code];
        return (
          <li key={code}>
            <a
              className={styles.link}
              href={`/${code}/${path}${path ? "/" : ""}`}
              hrefLang={code}
              aria-current={current === code ? "true" : undefined}
              onClick={() => writeLocal(LOCALE_STORAGE_KEY, code)}
              data-testid={`lang-${code}`}
            >
              <span className={styles.native} lang={code} dir={info.dir}>
                {info.native}
              </span>
              {info.native !== info.english ? (
                <span className={styles.english} lang="en" dir="ltr">
                  {info.english}
                </span>
              ) : null}
              {isMachine(code) && info.machineLabel ? (
                <span className={styles.machine} lang={code}>
                  {info.machineLabel}
                </span>
              ) : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
