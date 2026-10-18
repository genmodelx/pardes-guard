"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { IconDeviceMobile, IconLockKey, IconUserCircle } from "@/components/icons";
import { PageHead, Screen } from "@/components/shell/Screen";
import { Button } from "@/components/ui/Button";
import { GoogleMark } from "@/components/ui/GoogleMark";
import { Notice } from "@/components/ui/Notice";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/lib/auth";
import { useJourney, useStore } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import styles from "./SignIn.module.css";

/**
 * Sign in with Google, or carry on as a guest. Either way the person goes on to the three start
 * questions (or straight home, if this account already has a journey).
 */
export function SignIn() {
  const { t, href } = useI18n();
  const router = useRouter();
  const auth = useAuth();
  const { store } = useStore();
  const journey = useJourney();
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");
  const [leaving, setLeaving] = useState(false);

  // Leave only when the journey we are looking at belongs to the person now signed in. Right after
  // a Google sign-in the old guest data is still on screen for a moment; that is not the answer.
  const settled = store !== null && store.uid === auth.user.uid && (journey.status === "ready" || journey.status === "none");
  useEffect(() => {
    if (!leaving) return;
    if (journey.status === "error") {
      setLeaving(false);
      setState("failed");
      return;
    }
    if (settled) router.replace(href(journey.status === "ready" ? "/home" : "/start"));
  }, [leaving, settled, journey.status, router, href]);

  const google = async () => {
    setState("working");
    const result = await auth.signIn();
    if (result === "ok") setLeaving(true);
    else if (result === "cancelled") setState("idle");
    else if (result === "failed") setState("failed");
    // "redirecting": the browser is on its way to Google; leave the button busy.
  };

  const busy = state === "working" || leaving;

  return (
    <Screen bar={false} back={{ href: "/?choose=1", plain: true }}>
      {!auth.ready ? (
        <Skeleton block lines={3} label={t("common.loading")} />
      ) : !auth.user.guest ? (
        <>
          <PageHead title={t("signin.title")} />
          <p className={styles.line}>
            <IconUserCircle size={24} className={styles.lineIcon} />
            <span>{t("signin.as", { name: auth.user.name ?? auth.user.email ?? "" })}</span>
          </p>
          <div className={styles.actions}>
            <Button onClick={() => setLeaving(true)} busy={leaving} data-testid="continue">
              {t("welcome.continue")}
            </Button>
            <Button variant="secondary" full onClick={() => void auth.signOut()}>
              {t("signin.out")}
            </Button>
          </div>
        </>
      ) : auth.canSignIn ? (
        <>
          <PageHead title={t("signin.title")} lead={t("signin.lead")} />
          {state === "failed" ? (
            <Notice kind="error" title={t("error.title")}>
              <p>{t("signin.failed")}</p>
            </Notice>
          ) : null}
          <div className={styles.actions}>
            <Button onClick={google} busy={busy} icon={<GoogleMark />} data-testid="google">
              {state === "working" ? t("signin.working") : t("signin.google")}
            </Button>
            <Button variant="secondary" full onClick={() => setLeaving(true)} disabled={busy} data-testid="guest">
              {t("signin.guest")}
            </Button>
          </div>
          <p className={styles.line}>
            <IconDeviceMobile size={24} className={styles.lineIcon} />
            <span>{t("signin.guestNote")}</span>
          </p>
          <p className={styles.line}>
            <IconLockKey size={24} className={styles.lineIcon} />
            <span>{t("signin.never")}</span>
          </p>
        </>
      ) : (
        <>
          <PageHead title={t("brand")} lead={t("tagline")} />
          <Notice kind="info">
            <p>{t("signin.notSetUp")}</p>
          </Notice>
          <div className={styles.actions}>
            <Button onClick={() => setLeaving(true)} busy={leaving} data-testid="guest">
              {t("welcome.continue")}
            </Button>
          </div>
          <p className={styles.line}>
            <IconLockKey size={24} className={styles.lineIcon} />
            <span>{t("signin.never")}</span>
          </p>
        </>
      )}
    </Screen>
  );
}
