"use client";

import { IconCloudCheck, IconDeviceMobile, IconEyeSlash, IconRobot, IconShareNetwork, IconTrash, IconUsersThree } from "@/components/icons";
import { PageHead, Screen } from "@/components/shell/Screen";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import styles from "./Privacy.module.css";

const PARTS: { key: string; Icon: typeof IconDeviceMobile }[] = [
  { key: "phone", Icon: IconDeviceMobile },
  { key: "account", Icon: IconCloudCheck },
  { key: "gemini", Icon: IconRobot },
  { key: "shared", Icon: IconShareNetwork },
  { key: "who", Icon: IconUsersThree },
  { key: "never", Icon: IconEyeSlash },
  { key: "delete", Icon: IconTrash },
];

/** What the app keeps, where, and who can see it. Plain words, all of it on one page. */
export function PrivacyScreen() {
  const { t } = useI18n();
  return (
    <Screen tab="more" back={{ href: "/more", label: t("more.title") }}>
      <PageHead title={t("privacy.title")} lead={t("privacy.lead")} />
      <dl className={styles.list}>
        {PARTS.map(({ key, Icon }) => (
          <div key={key} className={styles.part}>
            <dt className={styles.term}>
              <Icon weight="duotone" size={28} className={styles.icon} />
              <span>{t(`privacy.${key}` as Key)}</span>
            </dt>
            <dd className={styles.desc}>{t(`privacy.${key}.d` as Key)}</dd>
          </div>
        ))}
      </dl>
    </Screen>
  );
}
