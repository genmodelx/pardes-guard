import type { Metadata } from "next";
import { BrandMark } from "@/components/shell/Brand";
import { en } from "@/lib/i18n/locales/en";
import { ur } from "@/lib/i18n/locales/ur";
import "./globals.css";
import styles from "./(welcome)/Welcome.module.css";

export const metadata: Metadata = { title: "Page not found · Pardes Guard", robots: { index: false } };

/** One 404 page for the whole site (Firebase Hosting serves 404.html). It cannot know the language, so it speaks both. */
export default function GlobalNotFound() {
  return (
    <html lang="en" dir="ltr">
      <body>
        <div className={styles.page} data-testid="not-found">
          <header className={styles.band}>
            <div className={styles.bandInner}>
              <div className={styles.brand}>
                <BrandMark size={44} />
                <div className={styles.names}>
                  <span className={styles.name}>{en.brand}</span>
                </div>
              </div>
              <div className={styles.pattern} aria-hidden="true" />
            </div>
          </header>
          <main className={styles.main}>
            <h1 className={styles.title}>
              <span>{en["notfound.title"]}</span>
              <span lang="ur" dir="rtl" className={styles.titleUr}>
                {ur["notfound.title"]}
              </span>
            </h1>
            <p className={styles.promise}>
              <span>{en["notfound.lead"]}</span>
              <span lang="ur" dir="rtl" className={styles.promiseUr}>
                {ur["notfound.lead"]}
              </span>
            </p>
            <ul className={styles.links}>
              <li>
                <a href="/?choose=1">{en["notfound.action"]}</a>
              </li>
              <li lang="ur" dir="rtl" className={styles.promiseUr}>
                <a href="/?choose=1">{ur["notfound.action"]}</a>
              </li>
            </ul>
          </main>
        </div>
      </body>
    </html>
  );
}
