import { BrandMark } from "@/components/shell/Brand";
import { LanguageLinks } from "@/components/shell/LanguageLinks";
import { firebaseEnabled } from "@/lib/firebase";
import { en } from "@/lib/i18n/locales/en";
import { ur } from "@/lib/i18n/locales/ur";
import styles from "./Welcome.module.css";

/**
 * First screen: choose a language. Each choice is a plain link, so it works before scripts load.
 * It leads to sign-in, or straight to the start questions in a copy of the app built without Firebase.
 */
export default function WelcomePage() {
  return (
    <div className={styles.page}>
      <header className={styles.band}>
        <div className={styles.bandInner}>
          <div className={styles.brand}>
            <BrandMark size={44} />
            <div className={styles.names}>
              <span className={styles.name}>{en.brand}</span>
              <span className={styles.nameUr} lang="ur" dir="rtl">
                {ur.brand}
              </span>
            </div>
          </div>
          <div className={styles.pattern} aria-hidden="true" />
        </div>
      </header>
      <main className={styles.main}>
        <h1 className={styles.title}>
          <span>{en["welcome.title"]}</span>
          <span lang="ur" dir="rtl" className={styles.titleUr}>
            {ur["welcome.title"]}
          </span>
        </h1>
        <LanguageLinks to={firebaseEnabled ? "/signin" : "/start"} />
        <p className={styles.promise}>
          <span>{en.tagline}</span>
          <span lang="ur" dir="rtl" className={styles.promiseUr}>
            {ur.tagline}
          </span>
        </p>
      </main>
    </div>
  );
}
