"use client";

import { IconSealCheck, IconWarning, IconXCircle } from "@/components/icons";
import { useI18n } from "@/lib/i18n";
import type { RecruiterRecord } from "@/lib/types";
import { Chip } from "./Chips";

const LOOK = {
  active: { tone: "ok", Icon: IconSealCheck },
  suspended: { tone: "amber", Icon: IconWarning },
  cancelled: { tone: "red", Icon: IconXCircle },
} as const;

/** A licence's status on the list. Each status has its own shape, so colour is never the only sign. */
export function RecruiterStatusChip({ status }: { status: RecruiterRecord["status"] }) {
  const { t } = useI18n();
  const { tone, Icon } = LOOK[status];
  return (
    <Chip tone={tone} icon={<Icon weight="fill" size={18} />}>
      {t(`rec.status.${status}`)}
    </Chip>
  );
}
