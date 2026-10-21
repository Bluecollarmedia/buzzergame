"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, History, Play, Plus, Radio, Users } from "lucide-react";
import { GAME_MODE_INFO, STATUS_LABELS, errorMessage, type EntitlementStatus } from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";
import { useApi } from "@/lib/useApi";
import { LIVE_STATUSES, type QuizRow, type SessionRow } from "@/lib/types";
import { formatDateTime, plural, relativeTime } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";
import { Alert, Badge, Card, EmptyState, PageHeader, PageSpinner } from "@/components/ui/Misc";
import { AccessSummary } from "./AccessBanner";

export function Dashboard() {
  const api = useApi();
  const [ent, setEnt] = useState<EntitlementStatus | null>(null);
  const [quizzes, setQuizzes] = useState<QuizRow[] | null>(null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [stats, setStats] = useState({ quizzes: 0, games: 0, players: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getSupabase();
    (async () => {
      try {
        const [e, q, s, qc, sc, pc] = await Promise.all([
          api.myEntitlement(),
          sb.from("quizzes").select("*, questions(count)").order("updated_at", { ascending: false }).limit(6),
          sb.from("game_sessions").select("id, quiz_id, quiz_title, mode, status, room_code, question_count, created_at, started_at, ended_at, participants(count)").order("created_at", { ascending: false }).limit(6),
          sb.from("quizzes").select("id", { count: "exact", head: true }),
          sb.from("game_sessions").select("id", { count: "exact", head: true }).eq("status", "finished"),
          sb.from("participants").select("id", { count: "exact", head: true }),
        ]);
        if (q.error) throw q.error;
        if (s.error) throw s.error;
        setEnt(e);
        setQuizzes(q.data as QuizRow[]);
        setSessions(s.data as SessionRow[]);
        setStats({ quizzes: qc.count ?? 0, games: sc.count ?? 0, players: pc.count ?? 0 });
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [api]);

  if (error) return <Alert>{error}</Alert>;
  if (!quizzes || !sessions) return <PageSpinner />;

  const live = sessions.filter((s) => LIVE_STATUSES.includes(s.status));
  const drafts = quizzes.filter((q) => q.status === "draft");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        actions={
          <Link href="/quizzes/new" className={buttonClasses("primary")}>
            <Plus className="size-4" aria-hidden /> Create a game
          </Link>
        }
      />

      <Card className="p-5">
        <AccessSummary ent={ent} />
      </Card>

      {live.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-ink-subtle">
            <Radio className="size-4 text-red-500" aria-hidden /> Live now
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {live.map((s) => (
              <Card key={s.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium">{s.quiz_title}</p>
                  <p className="text-sm text-ink-muted">
                    {STATUS_LABELS[s.status]} · {plural(s.participants?.[0]?.count ?? 0, "player")}
                  </p>
                </div>
                <Link href={`/sessions/${s.id}/host`} className={buttonClasses("primary", "sm")}>
                  Open controls
                </Link>
              </Card>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={<FileText className="size-4" />} label="Quizzes" value={stats.quizzes} />
        <Stat icon={<History className="size-4" />} label="Games played" value={stats.games} />
        <Stat icon={<Users className="size-4" />} label="Players hosted" value={stats.players} />
      </div>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Recent quizzes</h2>
          <Link href="/quizzes" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        {quizzes.length === 0 ? (
          <EmptyState
            icon={<Plus className="size-5" />}
            title="Create your first quiz"
            description="Pick a game mode, add a few questions and you're ready to play."
            action={
              <Link href="/quizzes/new" className={buttonClasses("primary")}>
                Create a game
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {quizzes.map((q) => (
              <Link key={q.id} href={`/quizzes/${q.id}`} className="block rounded-card border border-line bg-white p-4 transition-shadow hover:shadow-md">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone={q.status === "ready" ? "success" : "neutral"}>{q.status === "ready" ? "Ready" : "Draft"}</Badge>
                  <span className="text-xs text-ink-subtle">{relativeTime(q.updated_at)}</span>
                </div>
                <p className="mt-3 truncate font-medium">{q.title}</p>
                <p className="text-sm text-ink-muted">
                  {GAME_MODE_INFO[q.mode].name} · {plural(q.questions?.[0]?.count ?? 0, "question")}
                </p>
              </Link>
            ))}
          </div>
        )}
        {drafts.length > 0 && (
          <p className="mt-3 text-sm text-ink-muted">
            {plural(drafts.length, "draft")} waiting to be finished.
          </p>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Previous games</h2>
          <Link href="/sessions" className="text-sm text-primary hover:underline">
            View all
          </Link>
        </div>
        {sessions.filter((s) => !LIVE_STATUSES.includes(s.status)).length === 0 ? (
          <p className="rounded-card border border-dashed border-line bg-white px-4 py-6 text-center text-sm text-ink-muted">
            Games you host will appear here with their final standings.
          </p>
        ) : (
          <Card className="divide-y divide-line">
            {sessions
              .filter((s) => !LIVE_STATUSES.includes(s.status))
              .map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{s.quiz_title}</p>
                    <p className="text-sm text-ink-muted">
                      {formatDateTime(s.created_at)} · {plural(s.participants?.[0]?.count ?? 0, "player")}
                    </p>
                  </div>
                  {s.status === "finished" ? (
                    <Link href={`/sessions/${s.id}/results`} className={buttonClasses("secondary", "sm")}>
                      <Play className="size-3.5" aria-hidden /> Results
                    </Link>
                  ) : (
                    <Badge>{STATUS_LABELS[s.status]}</Badge>
                  )}
                </div>
              ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-sm text-ink-muted">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </Card>
  );
}
