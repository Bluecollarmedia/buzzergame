"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { GAME_MODE_INFO, STATUS_LABELS, errorMessage } from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";
import { useApi } from "@/lib/useApi";
import { LIVE_STATUSES, type SessionRow } from "@/lib/types";
import { formatDateTime, plural } from "@/lib/format";
import { Button, buttonClasses } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Alert, Badge, Card, EmptyState, PageHeader, PageSpinner } from "@/components/ui/Misc";
import { useToast } from "@/components/ui/Toast";
import { History } from "lucide-react";

export function SessionList() {
  const api = useApi();
  const toast = useToast();
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<SessionRow | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSupabase()
      .from("game_sessions")
      .select("id, quiz_id, quiz_title, mode, status, room_code, question_count, created_at, started_at, ended_at, participants(id)")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data, error }) => (error ? setError(errorMessage(error)) : setRows(data as SessionRow[])));
  }, []);

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await api.deleteSession(toDelete.id);
      setRows((r) => r?.filter((x) => x.id !== toDelete.id) ?? null);
      toast("success", "Game deleted");
    } catch (e) {
      toast("error", errorMessage(e));
    } finally {
      setBusy(false);
      setToDelete(null);
    }
  };

  return (
    <div>
      <PageHeader title="Games" description="Live and past games. Results are kept until you delete them." />
      {error && <Alert>{error}</Alert>}
      {!rows ? (
        <PageSpinner />
      ) : rows.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title="No games yet" description="Launch a quiz to run your first live game." action={<Link href="/quizzes" className={buttonClasses("primary")}>Go to quizzes</Link>} />
      ) : (
        <Card className="divide-y divide-line">
          {rows.map((s) => {
            const live = LIVE_STATUSES.includes(s.status);
            return (
              <div key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{s.quiz_title}</p>
                  <p className="text-sm text-ink-muted">
                    {GAME_MODE_INFO[s.mode].name} · {formatDateTime(s.created_at)} · {plural(s.participants?.length ?? 0, "player")}
                  </p>
                </div>
                <Badge tone={live ? "success" : s.status === "finished" ? "primary" : "neutral"}>{STATUS_LABELS[s.status]}</Badge>
                {live ? (
                  <Link href={`/sessions/${s.id}/host`} className={buttonClasses("primary", "sm")}>Controls</Link>
                ) : s.status === "finished" ? (
                  <Link href={`/sessions/${s.id}/results`} className={buttonClasses("secondary", "sm")}>Results</Link>
                ) : null}
                {!live && (
                  <Button variant="ghost" size="sm" aria-label={`Delete ${s.quiz_title} game`} onClick={() => setToDelete(s)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </Card>
      )}
      <ConfirmDialog
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={remove}
        loading={busy}
        destructive
        title="Delete this game?"
        confirmLabel="Delete"
        body="The results and the players' names for this game will be permanently deleted."
      />
    </div>
  );
}
