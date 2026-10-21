"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Crown, Trophy } from "lucide-react";
import { ANSWER_COLORS, GAME_MODE_INFO, errorMessage, winners, type SessionResults } from "@crowdquiz/shared";
import { useApi } from "@/lib/useApi";
import { formatDateTime } from "@/lib/format";
import { Alert, Card, PageHeader, PageSpinner } from "@/components/ui/Misc";

export function SessionResultsView({ sessionId }: { sessionId: string }) {
  const api = useApi();
  const [data, setData] = useState<SessionResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.sessionResults(sessionId).then(setData).catch((e) => setError(errorMessage(e)));
  }, [api, sessionId]);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <PageSpinner />;
  const top = winners(data.standings);
  const isMc = data.session.mode === "multiple_choice";

  return (
    <div>
      <Link href="/sessions" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Games
      </Link>
      <PageHeader
        title={data.session.title}
        description={`${GAME_MODE_INFO[data.session.mode].name} · ${formatDateTime(data.session.startedAt ?? data.session.createdAt)} · ${data.questionsPlayed} of ${data.session.questionCount} questions played`}
      />

      <Card className="mb-6 flex items-center gap-4 p-5">
        <div className="flex size-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
          <Trophy className="size-6" aria-hidden />
        </div>
        <div>
          {top.length === 0 ? (
            <p className="font-semibold">No winner: nobody scored.</p>
          ) : top.length === 1 ? (
            <p className="font-semibold">
              {top[0]!.displayName} won with {top[0]!.score} {top[0]!.score === 1 ? "point" : "points"}
            </p>
          ) : (
            <p className="font-semibold">
              Tie for first: {top.map((t) => t.displayName).join(", ")} ({top[0]!.score} points each)
            </p>
          )}
          <p className="text-sm text-ink-muted">{data.standings.length} players took part.</p>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Final standings</h2>
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wider text-ink-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Rank</th>
                <th className="px-4 py-2 font-medium">Player</th>
                <th className="px-4 py-2 text-right font-medium">Score</th>
                <th className="px-4 py-2 text-right font-medium">Correct</th>
                {isMc && <th className="px-4 py-2 text-right font-medium">Unanswered</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.standings.map((r) => (
                <tr key={r.participantId}>
                  <td className="px-4 py-2 font-semibold tabular-nums">{r.rank}</td>
                  <td className="px-4 py-2">{r.displayName}</td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums">{r.score}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.correctCount}</td>
                  {isMc && <td className="px-4 py-2 text-right tabular-nums">{Math.max(0, data.questionsPlayed - r.answeredCount)}</td>}
                </tr>
              ))}
              {data.standings.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                    No players joined this game.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-hidden">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Questions</h2>
          <ol className="divide-y divide-line">
            {data.questions.map((q) => (
              <li key={q.position} className="px-4 py-3 text-sm">
                <p className="font-medium">
                  {q.position + 1}. {q.prompt}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-ink-muted">
                  <span className="size-2.5 rounded-full" style={{ background: ANSWER_COLORS[q.correctIndex]!.bg }} aria-hidden />
                  <Check className="size-3.5 text-green-700" aria-hidden />
                  {q.choices[q.correctIndex]}
                </p>
                <p className="mt-1 text-xs text-ink-subtle">
                  {!q.played
                    ? "Not played"
                    : isMc
                      ? `${q.correctCount} of ${q.answerCount} answered correctly`
                      : q.winner
                        ? <span className="inline-flex items-center gap-1"><Crown className="size-3" aria-hidden /> Won by {q.winner}</span>
                        : "No winner"}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </div>
  );
}
