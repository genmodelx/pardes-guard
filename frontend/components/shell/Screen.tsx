"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { IconCaretLeft, IconCloudSlash, IconDotsThreeOutline, IconFileMagnifyingGlass, IconLifebuoy, IconPath, IconSiren, IconTranslate } from "@/components/icons";
import { LocaleLink } from "@/components/ui/LocaleLink";
import { cx } from "@/lib/cx";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { Brand } from "./Brand";
import styles from "./Shell.module.css";

export type Tab = "journey" | "check" | "help" | "more";

const TABS: { id: Tab; href: string; label: Key; Icon: typeof IconPath }[] = [
  { id: "journey", href: "/home", label: "nav.journey", Icon: IconPath },
  { id: "check", href: "/check", label: "nav.check", Icon: IconFileMagnifyingGlass },
  { id: "help", href: "/help", label: "nav.help", Icon: IconLifebuoy },
  { id: "more", href: "/more", label: "nav.more", Icon: IconDotsThreeOutline },
];

/** SOS is on every screen, in the same corner, and is never inside a menu. */
export function SosButton() {
  const { t } = useI18n();
  return (
    <LocaleLink href="/sos" prefetch className={styles.sos} aria-label={t("sos.buttonLabel")} data-testid="sos">
      <IconSiren weight="fill" size={22} />
      <span>{t("sos.button")}</span>
    </LocaleLink>
  );
}

export interface BackTarget {
  /** An app path without the language prefix. */
  href?: string;
  /** Use the href exactly as written (for the language picker at "/"). */
  plain?: boolean;
  /** Go back inside a flow instead of following a link (the previous question). */
  onClick?: () => void;
  label?: string;
}

function BackControl({ back }: { back: BackTarget }) {
  const { t } = useI18n();
  const inner = (
    <>
      <IconCaretLeft weight="bold" size={20} directional />
      <span>{back.label ?? t("common.back")}</span>
    </>
  );
  if (back.onClick) {
    return (
      <button type="button" className={styles.back} onClick={back.onClick} data-testid="back">
        {inner}
      </button>
    );
  }
  if (back.plain) {
    return (
      <a href={back.href ?? "/"} className={styles.back} data-testid="back">
        {inner}
      </a>
    );
  }
  return (
    <LocaleLink href={back.href ?? "/home"} className={styles.back} data-testid="back">
      {inner}
    </LocaleLink>
  );
}

function TopBar({ back, band }: { back?: BackTarget | null; band: boolean }) {
  const { t } = useI18n();
  return (
    <header className={styles.top}>
      <div className={styles.topInner}>
        {back ? (
          <BackControl back={back} />
        ) : (
          <LocaleLink href="/home" className={styles.brandLink}>
            <Brand name={t("brand")} />
          </LocaleLink>
        )}
        <SosButton />
      </div>
      {band ? <div className={styles.strip} aria-hidden="true" /> : null}
    </header>
  );
}

function BottomBar({ active }: { active?: Tab }) {
  const { t } = useI18n();
  return (
    <nav className={styles.tabs} aria-label={t("nav.label")}>
      <ul className={styles.tabList}>
        {TABS.map(({ id, href, label, Icon }) => {
          const on = id === active;
          return (
            <li key={id} className={styles.tabItem}>
              <LocaleLink href={href} prefetch className={cx(styles.tab, on && styles.tabOn)} aria-current={on ? "page" : undefined}>
                <Icon weight={on ? "fill" : "regular"} size={26} />
                <span>{t(label)}</span>
              </LocaleLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export interface ScreenProps {
  /** Which bottom-bar item this screen belongs to. */
  tab?: Tab;
  /** Where Back goes. Leave out on the four tab roots, which show the brand instead. */
  back?: BackTarget | null;
  /** Hide the bottom bar on focused flows (the three start questions, sign-in). */
  bar?: boolean;
  /** Run the security-print strip under the top bar. Home only. */
  band?: boolean;
  /** NGO and admin tables may use the wider column. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * On a language drafted by machine, one quiet line at the top of every screen says so, with a way to
 * read the same screen in English. Nothing is written to storage: the next visit opens in the
 * person's own language again.
 */
function MachineNote() {
  const { t, machine } = useI18n();
  const pathname = usePathname() ?? "/";
  if (!machine) return null;
  const rest = pathname.replace(/^\/[^/]+/, "") || "/";
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    window.location.assign(`/en${rest}${window.location.search}${window.location.hash}`);
  };
  return (
    <p className={styles.machine} data-testid="machine-note">
      <IconTranslate size={18} className={styles.machineIcon} />
      <span>{t("lang.machine")}</span>
      <a href={`/en${rest}`} hrefLang="en" onClick={open}>
        {t("lang.english")}
      </a>
    </p>
  );
}

/** With no connection, one line says the screen shows what was saved on this phone. */
function OfflineNote() {
  const { t } = useI18n();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (!offline) return null;
  return (
    <p className={styles.offline} role="status" data-testid="offline-note">
      <IconCloudSlash size={20} className={styles.machineIcon} />
      <span>{t("offline.note")}</span>
    </p>
  );
}

/** The frame every screen sits in: skip link, top bar with SOS, the page column, the bottom bar. */
export function Screen({ tab, back, bar = true, band = false, wide = false, children }: ScreenProps) {
  const { t } = useI18n();
  return (
    <div className={cx(styles.frame, bar && styles.withTabs)}>
      <a className="skip-link" href="#main">
        {t("skip")}
      </a>
      <TopBar back={back} band={band} />
      <main id="main" tabIndex={-1} className={cx(styles.main, wide && styles.wide)}>
        <OfflineNote />
        <MachineNote />
        {children}
      </main>
      {bar ? <BottomBar active={tab} /> : null}
    </div>
  );
}

/** Holds the screen's one primary action in the bottom third, above the bottom bar. */
export function StickyActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>;
}

/** The title block at the top of a screen. The title can take focus, so a flow can announce a new question. */
export function PageHead({ title, lead, id, lang, children }: { title: string; lead?: string; id?: string; lang?: string; children?: ReactNode }) {
  return (
    <header className={styles.head}>
      <h1 id={id} tabIndex={-1} lang={lang}>
        {title}
      </h1>
      {lead ? <p className={styles.lead}>{lead}</p> : null}
      {children}
    </header>
  );
}

/** A titled block inside a screen. */
export function Section({ title, children, id }: { title?: string; children: ReactNode; id?: string }) {
  return (
    <section className={styles.section} aria-labelledby={title && id ? id : undefined}>
      {title ? <h2 id={id}>{title}</h2> : null}
      {children}
    </section>
  );
}
