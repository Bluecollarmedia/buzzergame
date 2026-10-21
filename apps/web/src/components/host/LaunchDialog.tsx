"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { GAME_MODE_INFO, normalizeSessionSettings, toAppError, errorMessage, type SessionSettings } from "@crowdquiz/shared";
import { useApi } from "@/lib/useApi";
import type { QuizRow } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Alert } from "@/components/ui/Misc";
import { SettingsForm } from "./SettingsForm";

/** Choose settings for this game and create the live session. */
export function LaunchDialog({ quiz, onClose }: { quiz: Pick<QuizRow, "id" | "title" | "mode" | "settings">; onClose: () => void }) {
  const api = useApi();
  const router = useRouter();
  const [settings, setSettings] = useState<SessionSettings>(() => normalizeSessionSettings(quiz.mode, quiz.settings));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; code: string } | null>(null);

  const launch = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.createSession(quiz.id, settings as unknown as Record<string, unknown>);
      router.push(`/sessions/${s.sessionId}/host`);
    } catch (e) {
      setBusy(false);
      setError({ text: errorMessage(e), code: toAppError(e).code });
    }
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Launch “${quiz.title}”`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={launch} loading={busy} icon={<Play className="size-4" aria-hidden />}>
            Open lobby
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-ink-muted">
        {GAME_MODE_INFO[quiz.mode].name}. Opening the lobby shows a QR code for players. The game starts when you press Start.
      </p>
      {error && (
        <Alert className="mb-4">
          {error.text}{" "}
          {(error.code === "no_entitlement" || error.code === "session_limit_reached") && (
            <Link href="/account/redeem" className="font-medium underline">
              Redeem an access code
            </Link>
          )}
        </Alert>
      )}
      <SettingsForm mode={quiz.mode} value={settings} onChange={setSettings} />
    </Dialog>
  );
}
