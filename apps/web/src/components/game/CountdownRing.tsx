import { cn } from "@/components/ui/cn";

export function CountdownRing({
  remainingMs,
  totalMs,
  className,
  tone = "stage",
}: {
  remainingMs: number | null;
  totalMs: number;
  className?: string;
  tone?: "stage" | "light";
}) {
  const secs = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const frac = remainingMs === null || totalMs <= 0 ? 0 : Math.max(0, Math.min(1, remainingMs / totalMs));
  const r = 44;
  const c = 2 * Math.PI * r;
  const urgent = secs !== null && secs <= 5;
  return (
    <div className={cn("relative grid place-items-center", className)} role="timer" aria-label={secs === null ? "No timer" : `${secs} seconds left`}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" className={tone === "stage" ? "stroke-white/10" : "stroke-slate-200"} />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className={cn("transition-[stroke-dashoffset] duration-100 ease-linear", urgent ? "stroke-red-500" : tone === "stage" ? "stroke-white" : "stroke-primary")}
        />
      </svg>
      <span className={cn("relative font-bold tabular-nums", tone === "stage" ? "text-white" : "text-ink", urgent && "text-red-500")}>
        {secs ?? "–"}
      </span>
    </div>
  );
}
