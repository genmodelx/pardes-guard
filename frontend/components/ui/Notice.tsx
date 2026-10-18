"use client";

import type { ReactNode } from "react";
import { IconCheckCircle, IconInfo, IconRobot, IconWarning, IconWarningOctagon } from "@/components/icons";
import { cx } from "@/lib/cx";
import { useI18n } from "@/lib/i18n";
import { Button } from "./Button";
import styles from "./Notice.module.css";

type Kind = "info" | "warning" | "error" | "success";

const ICON = { info: IconInfo, warning: IconWarning, error: IconWarningOctagon, success: IconCheckCircle };

/**
 * A message block. Each kind has its own icon shape. An error always says what happened and what
 * to do next, and can carry the button that does it.
 */
export function Notice({
  kind = "info",
  title,
  children,
  action,
  onAction,
  actionHref,
}: {
  kind?: Kind;
  title?: string;
  children?: ReactNode;
  action?: string;
  onAction?: () => void;
  actionHref?: string;
}) {
  const Icon = ICON[kind];
  return (
    <div className={cx(styles.notice, styles[kind])} role={kind === "error" ? "alert" : kind === "success" ? "status" : undefined}>
      <Icon weight="fill" size={24} className={styles.icon} />
      <div className={styles.body}>
        {title ? <p className={styles.title}>{title}</p> : null}
        {children ? <div className={styles.text}>{children}</div> : null}
        {action ? (
          <div className={styles.action}>
            <Button variant="secondary" compact full={false} onClick={onAction} href={actionHref}>
              {action}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The fixed line under every AI-assisted result. */
export function AiLine({ text }: { text?: string }) {
  const { t } = useI18n();
  return (
    <p className={styles.ai}>
      <IconRobot size={22} className={styles.aiIcon} />
      <span>{text ?? t("ai.line")}</span>
    </p>
  );
}

/** Standard error block for a failed load or save, with a retry button. */
export function ErrorNotice({ kind = "generic", onRetry }: { kind?: "generic" | "save" | "load" | "offline"; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <Notice kind="error" title={t("error.title")} action={onRetry ? t("common.retry") : undefined} onAction={onRetry}>
      <p>{t(`error.${kind}`)}</p>
    </Notice>
  );
}
