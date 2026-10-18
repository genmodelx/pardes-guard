"use client";

import { useState } from "react";
import { IconMegaphone } from "@/components/icons";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/data";
import { useI18n } from "@/lib/i18n";
import { Button } from "./Button";
import { TextArea } from "./Field";
import { ErrorNotice, Notice } from "./Notice";
import { Sheet } from "./Sheet";

/**
 * Report an agent to our team. Reports go to staff only (Firestore rules), never to the public, so
 * this needs an account; a guest is asked to sign in. Nothing is sent until the person taps Send.
 */
export function ReportSheet({ open, onClose, recruiter, checkId = null }: { open: boolean; onClose: () => void; recruiter: { name: string | null; license: string | null }; checkId?: string | null }) {
  const { t } = useI18n();
  const { store } = useStore();
  const auth = useAuth();
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed" | "empty">("idle");
  const canSend = store?.kind === "firestore";
  const send = async () => {
    if (!store) return;
    if (text.trim().length < 3) return setState("empty");
    setState("sending");
    try {
      await store.addReport({ kind: "recruiter", text, recruiter_name: recruiter.name, recruiter_license: recruiter.license, check_id: checkId });
      setState("sent");
    } catch {
      setState("failed");
    }
  };
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("report.title")}
      footer={
        canSend && state !== "sent" ? (
          <Button onClick={() => void send()} busy={state === "sending"} icon={<IconMegaphone size={22} />} data-testid="send-report">
            {t("report.send")}
          </Button>
        ) : !canSend && auth.canSignIn ? (
          <Button href="/signin">{t("common.signin")}</Button>
        ) : null
      }
    >
      {state === "sent" ? (
        <Notice kind="success">
          <p>{t("report.sent")}</p>
        </Notice>
      ) : canSend ? (
        <>
          <p>{t("report.lead")}</p>
          <TextArea label={t("report.text")} value={text} onChange={setText} rows={4} error={state === "empty" ? t("report.empty") : null} />
          {state === "failed" ? <ErrorNotice kind="save" onRetry={() => void send()} /> : null}
        </>
      ) : (
        <p>{auth.canSignIn ? t("report.signin") : t("report.offline")}</p>
      )}
    </Sheet>
  );
}
