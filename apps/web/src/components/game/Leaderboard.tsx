import { Trophy } from "lucide-react";
import type { LeaderboardRow } from "@crowdquiz/shared";
import { cn } from "@/components/ui/cn";

export function Leaderboard({
  rows,
  highlightId,
  variant = "stage",
  limit = 10,
}: {
  rows: LeaderboardRow[];
  highlightId?: string;
  variant?: "stage" | "light";
  limit?: number;
}) {
  const stage = variant === "stage";
  if (rows.length === 0) {
    return <p className={cn("text-center", stage ? "text-white/60" : "text-ink-muted")}>No players yet.</p>;
  }
  return (
    <ol className="space-y-[0.6em]">
      {rows.slice(0, limit).map((r) => (
        <li
          key={r.participantId}
          className={cn(
            "flex animate-rise items-center gap-[0.8em] rounded-[0.6em] px-[0.9em] py-[0.55em]",
            stage ? "bg-white/[0.06] text-white" : "bg-surface-muted text-ink",
            r.participantId === highlightId && (stage ? "bg-white/20 ring-2 ring-white/60" : "bg-primary-soft ring-2 ring-primary"),
          )}
        >
          <span className={cn("w-[1.8em] text-center font-bold tabular-nums", r.rank === 1 ? "text-amber-400" : stage ? "text-white/60" : "text-ink-subtle")}>
            {r.rank === 1 ? <Trophy className="mx-auto size-[1em]" aria-label="First place" /> : r.rank}
          </span>
          <span className="flex-1 truncate font-semibold">{r.displayName}</span>
          <span className="font-bold tabular-nums">{r.score}</span>
        </li>
      ))}
    </ol>
  );
}
