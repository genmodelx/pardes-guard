"use client";

import { IconChalkboardTeacher, IconChatCircleText, IconCoins, IconScales, IconSiren, IconUsersThree, IconVault } from "@/components/icons";
import { PageHead, Screen, Section } from "@/components/shell/Screen";
import { Advanced } from "@/components/ui/Advanced";
import { MenuList, MenuRow } from "@/components/ui/StepRow";
import { useI18n } from "@/lib/i18n";

/** Help: where to go when something goes wrong. */
export function Help() {
  const { t } = useI18n();
  return (
    <Screen tab="help">
      <PageHead title={t("help.title")} lead={t("help.lead")} />
      <MenuList>
        <MenuRow href="/sos" icon={<IconSiren weight="fill" size={26} />} title={t("home.sos.action")} description={t("home.sos.title")} />
        <MenuRow href="/cases" icon={<IconScales weight="duotone" size={26} />} title={t("cases.title")} description={t("help.cases.d")} />
        {/* Simple mode keeps three: SOS, cases and the assistant. The wage check and the vault are one tap away inside a case. */}
        <Advanced>
          <MenuRow href="/wage" icon={<IconCoins weight="duotone" size={26} />} title={t("cases.wage")} description={t("cases.wage.d")} />
          <MenuRow href="/vault" icon={<IconVault weight="duotone" size={26} />} title={t("vault.title")} description={t("help.vault.d")} />
          <MenuRow href="/family" icon={<IconUsersThree weight="duotone" size={26} />} title={t("family.title")} description={t("help.family.d")} />
        </Advanced>
      </MenuList>
      <Section title={t("help.ask")} id="help-ask">
        <MenuList>
          <MenuRow href="/assistant" icon={<IconChatCircleText weight="duotone" size={26} />} title={t("assistant.title")} description={t("help.assistant.d")} />
          <Advanced>
            <MenuRow href="/interview" icon={<IconChalkboardTeacher weight="duotone" size={26} />} title={t("interview.title")} description={t("help.interview.d")} />
          </Advanced>
        </MenuList>
      </Section>
    </Screen>
  );
}
