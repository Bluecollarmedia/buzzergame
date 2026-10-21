import { brand } from "@crowdquiz/shared";
import { cn } from "./cn";

/** Placeholder wordmark. Replace with the final logo when it is ready. */
export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span aria-hidden className="grid size-7 grid-cols-2 gap-0.5 rounded-md p-1" style={{ background: inverted ? "rgba(255,255,255,0.1)" : "#0f172a" }}>
        <span className="rounded-[2px] bg-answer-a" />
        <span className="rounded-[2px] bg-answer-b" />
        <span className="rounded-[2px] bg-answer-c" />
        <span className="rounded-[2px] bg-answer-d" />
      </span>
      <span className={inverted ? "text-white" : "text-ink"}>{brand.productName}</span>
    </span>
  );
}
