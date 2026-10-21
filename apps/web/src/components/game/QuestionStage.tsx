import { Check, Crown } from "lucide-react";
import { ANSWER_COLORS, type GameMode } from "@crowdquiz/shared";
import { cn } from "@/components/ui/cn";

/**
 * The question and its four answers as shown on the projector. Also used
 * for the editor preview. Sizes use container query units so the layout
 * scales with whatever box it is placed in.
 */
export function QuestionStage({
  prompt,
  choices,
  mode,
  correctIndex = null,
  distribution = null,
  winner = null,
  questionLabel,
  className,
}: {
  prompt: string;
  choices: readonly string[];
  mode: GameMode;
  correctIndex?: number | null;
  distribution?: readonly number[] | null;
  winner?: { displayName: string; choiceIndex: number } | null;
  questionLabel?: string;
  className?: string;
}) {
  const revealed = correctIndex !== null && correctIndex !== undefined;
  const total = distribution ? distribution.reduce((a, b) => a + b, 0) : 0;
  const long = prompt.length > 140;
  return (
    <div className={cn("@container flex h-full w-full flex-col", className)}>
      {questionLabel && (
        <div className="mb-[2cqw] text-[1.6cqw] font-semibold uppercase tracking-[0.2em] text-white/50">{questionLabel}</div>
      )}
      <h2
        className={cn(
          "font-semibold leading-tight text-white text-balance",
          long ? "text-[3.4cqw]" : "text-[4.4cqw]",
        )}
      >
        {prompt || <span className="text-white/30">Your question will appear here</span>}
      </h2>
      <div className="mt-auto grid grid-cols-2 gap-[1.6cqw] pt-[3cqw]">
        {ANSWER_COLORS.map((c, i) => {
          const isCorrect = revealed && i === correctIndex;
          const dim = revealed && !isCorrect;
          const count = distribution?.[i] ?? 0;
          return (
            <div
              key={c.label}
              className={cn(
                "relative flex min-h-[9cqw] items-center gap-[1.6cqw] overflow-hidden rounded-[1.4cqw] px-[2cqw] py-[1.6cqw] text-white transition-opacity duration-300",
                dim && "opacity-30",
                isCorrect && "ring-[0.5cqw] ring-white",
              )}
              style={{ background: c.bg }}
            >
              {distribution && total > 0 && (
                <div
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-black/20 transition-[width] duration-700"
                  style={{ width: `${(count / total) * 100}%` }}
                />
              )}
              <span className="relative grid size-[5cqw] shrink-0 place-items-center rounded-[0.8cqw] bg-black/25 text-[2.6cqw] font-bold">
                {c.label}
              </span>
              <span className="relative flex-1 text-[2.6cqw] font-semibold leading-snug">
                {choices[i] || <span className="text-white/50">{mode === "color_buzzer" ? c.name : `Answer ${c.label}`}</span>}
              </span>
              {isCorrect && <Check className="relative size-[3.4cqw] shrink-0" aria-label="Correct answer" />}
              {distribution && revealed && (
                <span className="relative text-[2.2cqw] font-bold tabular-nums">{count}</span>
              )}
              {winner && winner.choiceIndex === i && (
                <Crown className="relative size-[3cqw] shrink-0" aria-hidden />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
