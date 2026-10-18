"use client";

import { useEffect, useState } from "react";
import { IconCalendarBlank, IconCloudArrowDown, IconUserGear, IconDatabase, IconDeviceMobile, IconShieldWarning, IconFiles, IconListChecks, IconMoon, IconPath, IconSignIn, IconSignOut, IconSun, IconTrash, IconUserCircle } from "@/components/icons";
import { LanguageLinks } from "@/components/shell/LanguageLinks";
import { Advanced } from "@/components/ui/Advanced";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ChoiceGroup, ChoiceTile } from "@/components/ui/ChoiceTile";
import { Select } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { ConfirmDialog } from "@/components/ui/Sheet";
import { MenuList, MenuRow } from "@/components/ui/StepRow";
import { useAuth } from "@/lib/auth";
import { useJourney, useStore } from "@/lib/data";
import { AI_LANGUAGES, THEME_STORAGE_KEY, languageInfo, useI18n } from "@/lib/i18n";
import { deleteEverything, type WipeResult } from "@/lib/privacy";
import { offlineKitStatus, offlineSupported, saveOfflineKit, type KitSaved } from "@/lib/offline-kit";
import { isStaff, useRole } from "@/lib/role";
import { setSimpleMode, useSimpleMode } from "@/lib/simple";
import { readLocal, writeLocal } from "@/lib/storage";
import styles from "./More.module.css";

type Theme = "system" | "light" | "dark";

/** The saved theme, and a setter that applies it to the page at once. */
function useTheme(): [Theme, (theme: Theme) => void] {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    const saved = readLocal<string | null>(THEME_STORAGE_KEY, null);
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);
  const apply = (next: Theme) => {
    setTheme(next);
    writeLocal(THEME_STORAGE_KEY, next);
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
  };
  return [theme, apply];
}

/** "Use without internet": when the key screens were last kept on this phone, and a button to do it now. */
function OfflineKit() {
  const { t, locale, date } = useI18n();
  const journey = useJourney();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [saved, setSaved] = useState<KitSaved | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  useEffect(() => {
    const ok = offlineSupported();
    setSupported(ok);
    if (ok) void offlineKitStatus(locale).then(setSaved);
  }, [locale]);
  const save = async () => {
    setState("saving");
    const packs = [journey.plan?.answers.origin, journey.plan?.answers.destination].filter((c): c is string => Boolean(c));
    const result = await saveOfflineKit(locale, packs);
    setState(result ? "idle" : "failed");
    if (result) setSaved(result);
  };
  return (
    <Section title={t("settings.offline")} id="more-offline">
      <p className={styles.note}>{t("settings.offline.help")}</p>
      {supported === false ? (
        <p className={styles.note}>{t("settings.offline.none")}</p>
      ) : (
        <>
          {saved ? (
            <p className={styles.note} role="status" data-testid="offline-saved">
              {t("settings.offline.saved", { date: date(saved.at) })}
            </p>
          ) : null}
          <Button variant="secondary" full={false} busy={state === "saving"} disabled={supported === null} onClick={() => void save()} icon={<IconCloudArrowDown size={22} />} data-testid="offline-save">
            {state === "saving" ? t("settings.offline.saving") : t("settings.offline.save")}
          </Button>
          {state === "failed" ? (
            <p className={styles.problem} role="alert">
              {t("settings.offline.failed")}
            </p>
          ) : null}
        </>
      )}
    </Section>
  );
}

/** More: the other tools, and the settings for language, screen and account. */
export function More() {
  const { t, locale, machine } = useI18n();
  const auth = useAuth();
  const { store } = useStore();
  const journey = useJourney();
  const [theme, setTheme] = useTheme();
  const simple = useSimpleMode();
  const role = useRole();
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wiped, setWiped] = useState<WipeResult | null>(null);

  const save = async (patch: Parameters<typeof journey.saveSettings>[0]) => setSaved(await journey.saveSettings(patch));

  const wipe = async () => {
    if (!store) return;
    setWiping(true);
    const result = await deleteEverything({ store, deleteAccount: auth.deleteAccount });
    // A guest starts again as a new guest; an account that was deleted is already signed out.
    if (result === "done" && auth.user.guest) await auth.signOut();
    setWiping(false);
    setConfirming(false);
    setWiped(result);
    journey.reload();
  };

  return (
    <Screen tab="more">
      <PageHead title={t("more.title")} />

      <Section title={t("more.tools")} id="more-tools">
        <MenuList>
          <MenuRow href="/journey" icon={<IconPath weight="fill" size={26} />} title={t("more.journey")} description={t("more.journey.d")} />
          <MenuRow href="/documents" icon={<IconFiles weight="duotone" size={26} />} title={t("home.q.docs")} description={t("home.q.docs.d")} />
          <MenuRow href="/dates" icon={<IconCalendarBlank weight="duotone" size={26} />} title={t("dates.title")} description={t("dates.d")} />
          <Advanced>
            <MenuRow href="/eligibility" icon={<IconListChecks weight="duotone" size={26} />} title={t("elig.title")} description={t("app.eligibility.d")} />
          </Advanced>
        </MenuList>
      </Section>

      <Section title={t("settings.language")} id="more-language">
        <LanguageLinks to="/more" current={locale} />
        {machine ? <p className={styles.note}>{t("lang.machine")}</p> : null}
        <Advanced>
          <Select
            label={t("settings.ai")}
            hint={t("settings.ai.help")}
            value={journey.settings.ai_language ?? ""}
            onChange={(v) => void save({ ai_language: v || null })}
            options={AI_LANGUAGES.map((code) => ({ value: code, label: `${languageInfo(code).native} (${languageInfo(code).english})` }))}
            placeholder={t("settings.ai.same")}
          />
        </Advanced>
        {saved ? (
          <p className={styles.note} role="status">
            {t("settings.saved")}
          </p>
        ) : null}
      </Section>

      <Section title={t("settings.theme")} id="more-theme">
        <ChoiceGroup legendId="more-theme" dense>
          <ChoiceTile value="system" checked={theme === "system"} onChange={() => setTheme("system")} picture={<IconDeviceMobile size={28} />} title={t("theme.system")} />
          <ChoiceTile value="light" checked={theme === "light"} onChange={() => setTheme("light")} picture={<IconSun size={28} />} title={t("theme.light")} />
          <ChoiceTile value="dark" checked={theme === "dark"} onChange={() => setTheme("dark")} picture={<IconMoon size={28} />} title={t("theme.dark")} />
        </ChoiceGroup>
        <Checkbox checked={simple} onChange={setSimpleMode} label={t("settings.simple")} hint={t("settings.simple.help")} />
      </Section>

      <OfflineKit />

      <Section title={t("settings.privacy")} id="more-privacy">
        {store?.kind === "firestore" ? (
          <Checkbox checked={journey.settings.share_signals} onChange={(v) => void save({ share_signals: v })} label={t("settings.share")} hint={t("settings.share.help")} />
        ) : (
          <>
            <Checkbox checked={false} onChange={() => undefined} label={t("settings.share")} hint={t("settings.share.help")} disabled />
            <p className={styles.note}>{t("settings.share.signin")}</p>
          </>
        )}
        <MenuList>
          <MenuRow href="/privacy" icon={<IconDatabase weight="duotone" size={26} />} title={t("settings.stored")} description={t("settings.stored.d")} />
        </MenuList>
        <Button variant="danger" onClick={() => setConfirming(true)} icon={<IconTrash size={22} />} disabled={!store} data-testid="delete-everything">
          {t("settings.delete")}
        </Button>
        <p className={styles.note}>{t("settings.delete.d")}</p>
        {wiped === "done" ? (
          <Notice kind="success">
            <p>{t("settings.delete.done")}</p>
          </Notice>
        ) : wiped === "needs-recent-login" ? (
          <Notice kind="warning">
            <p>{t("settings.delete.reauth")}</p>
          </Notice>
        ) : wiped === "failed" ? (
          <Notice kind="error">
            <p>{t("settings.delete.failed")}</p>
          </Notice>
        ) : null}
      </Section>

      <Section title={t("settings.account")} id="more-account">
        {!auth.ready ? null : auth.user.guest ? (
          <>
            <p>{t("settings.guest")}</p>
            {auth.canSignIn ? (
              <Button variant="secondary" full href="/signin" icon={<IconSignIn size={22} />}>
                {t("common.signin")}
              </Button>
            ) : (
              <Notice kind="info">
                <p>{t("signin.notSetUp")}</p>
              </Notice>
            )}
          </>
        ) : (
          <>
            <p className={styles.account}>
              <IconUserCircle size={24} />
              <span>{t("signin.as", { name: auth.user.name ?? auth.user.email ?? "" })}</span>
            </p>
            <Button variant="secondary" full onClick={() => void auth.signOut()} icon={<IconSignOut size={22} />} data-testid="sign-out">
              {t("signin.out")}
            </Button>
          </>
        )}
      </Section>

      {/* Staff screens: a signed-in person sees them when roles/{uid} says so; a guest may try them with sample data. */}
      <Advanced>
        {role.ready && (auth.user.guest || isStaff(role.role)) ? (
          <Section title={t("ngo.staff")} id="more-staff">
            {auth.user.guest ? (
              <Checkbox checked={isStaff(auth.demoRole)} onChange={(on) => auth.setDemoRole(on ? "admin" : "worker")} label={t("settings.tryStaff")} hint={t("settings.tryStaff.help")} />
            ) : null}
            {isStaff(role.role) ? (
              <MenuList>
                <MenuRow href="/ngo" icon={<IconShieldWarning weight="duotone" size={26} />} title={t("ngo.title")} description={t("ngo.open.d")} />
                {role.role === "admin" ? <MenuRow href="/admin" icon={<IconUserGear weight="duotone" size={26} />} title={t("admin.title")} description={t("admin.open.d")} /> : null}
              </MenuList>
            ) : null}
          </Section>
        ) : null}
      </Advanced>

      <ConfirmDialog
        open={confirming}
        title={t("settings.delete.title")}
        body={<p>{t("settings.delete.lead")}</p>}
        confirmLabel={t("settings.delete.confirm")}
        danger
        busy={wiping}
        onConfirm={() => void wipe()}
        onCancel={() => setConfirming(false)}
      />
    </Screen>
  );
}
