import { Wifi, WifiOff } from "lucide-react";
import type { ConnectionStatus } from "@crowdquiz/shared";
import { cn } from "@/components/ui/cn";

const LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  polling: "Connected",
  reconnecting: "Reconnecting",
};

export function ConnectionBadge({ status, tone = "light", className }: { status: ConnectionStatus; tone?: "light" | "stage"; className?: string }) {
  const bad = status === "reconnecting";
  const ok = status === "live" || status === "polling";
  return (
    <span
      role="status"
      title={status === "polling" ? "Realtime unavailable; refreshing automatically" : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "stage" ? "bg-white/10 text-white/80" : "bg-slate-100 text-ink-muted",
        bad && (tone === "stage" ? "bg-red-500/20 text-red-200" : "bg-red-50 text-red-700"),
        className,
      )}
    >
      {bad ? <WifiOff className="size-3.5" aria-hidden /> : <Wifi className="size-3.5" aria-hidden />}
      <span className={cn("size-1.5 rounded-full", ok ? "bg-green-500" : bad ? "bg-red-500" : "bg-amber-400")} aria-hidden />
      {LABELS[status]}
    </span>
  );
}
