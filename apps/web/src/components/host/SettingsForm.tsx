"use client";

import { SETTING_LIMITS, type GameMode, type SessionSettings } from "@crowdquiz/shared";
import { Field, Input, Toggle } from "@/components/ui/Field";

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  suffix?: string;
  hint?: string;
}) {
  const id = `f-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <Field label={label} htmlFor={id} hint={hint ?? `${min}–${max}${suffix ? ` ${suffix}` : ""}`}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={() => onChange(Math.max(min, Math.min(max, Math.round(value || min))))}
      />
    </Field>
  );
}

/** Editor for session settings. Values are clamped again by the server. */
export function SettingsForm({
  mode,
  value,
  onChange,
}: {
  mode: GameMode;
  value: SessionSettings;
  onChange: (v: SessionSettings) => void;
}) {
  const set = <K extends keyof SessionSettings>(k: K, v: SessionSettings[K]) => onChange({ ...value, [k]: v });
  const L = SETTING_LIMITS;
  return (
    <div className="space-y-5">
      {mode === "multiple_choice" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Question timer" suffix="seconds" value={value.timeLimitSeconds} onChange={(n) => set("timeLimitSeconds", n)} min={L.timeLimitSeconds.min} max={L.timeLimitSeconds.max} />
          <NumberField label="Points for a correct answer" value={value.pointsCorrect} onChange={(n) => set("pointsCorrect", n)} min={L.pointsCorrect.min} max={L.pointsCorrect.max} />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField label="Points for the winner" value={value.pointsCorrect} onChange={(n) => set("pointsCorrect", n)} min={L.pointsCorrect.min} max={L.pointsCorrect.max} />
          <div>
            <Toggle
              label="Question time limit"
              description="Off by default. Close the question automatically."
              checked={value.buzzerTimeLimitSeconds !== null}
              onChange={(on) => set("buzzerTimeLimitSeconds", on ? L.buzzerTimeLimitSeconds.default : null)}
            />
            {value.buzzerTimeLimitSeconds !== null && (
              <NumberField label="Time limit" suffix="seconds" value={value.buzzerTimeLimitSeconds} onChange={(n) => set("buzzerTimeLimitSeconds", n)} min={L.buzzerTimeLimitSeconds.min} max={L.buzzerTimeLimitSeconds.max} />
            )}
          </div>
        </div>
      )}

      <div className="divide-y divide-line rounded-lg border border-line px-4">
        <Toggle
          label="Advance automatically"
          description="Reveal, show the leaderboard and start the next question without pressing anything."
          checked={value.autoAdvance}
          onChange={(v) => set("autoAdvance", v)}
        />
        <Toggle label="Show leaderboard between questions" checked={value.showLeaderboard} onChange={(v) => set("showLeaderboard", v)} />
        <Toggle label="Allow players to join after the game starts" checked={value.allowLateJoin} onChange={(v) => set("allowLateJoin", v)} />
        {mode === "multiple_choice" ? (
          <>
            <Toggle label="Let players change their answer before time runs out" checked={value.allowAnswerChange} onChange={(v) => set("allowAnswerChange", v)} />
            <Toggle label="Speed bonus" description="Faster correct answers earn extra points." checked={value.speedBonus} onChange={(v) => set("speedBonus", v)} />
            <Toggle label="Show answer text on phones" description="Off shows only the A/B/C/D letters." checked={value.showChoicesOnPhone} onChange={(v) => set("showChoicesOnPhone", v)} />
          </>
        ) : (
          <Toggle
            label="Lock out wrong answers"
            description="A player who presses the wrong colour can't try again on that question."
            checked={value.buzzerLockout}
            onChange={(v) => set("buzzerLockout", v)}
          />
        )}
        <Toggle label="Allow replaying a question" checked={value.allowReplay} onChange={(v) => set("allowReplay", v)} />
      </div>

      {mode === "multiple_choice" && value.speedBonus && (
        <NumberField label="Maximum speed bonus" suffix="points" value={value.speedBonusMaxPoints} onChange={(n) => set("speedBonusMaxPoints", n)} min={L.speedBonusMaxPoints.min} max={L.speedBonusMaxPoints.max} />
      )}

      <details className="rounded-lg border border-line px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Timing and limits</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberField label="Get-ready countdown" suffix="seconds" value={value.countdownSeconds} onChange={(n) => set("countdownSeconds", n)} min={L.countdownSeconds.min} max={L.countdownSeconds.max} />
          <NumberField label="Answer reveal" suffix="seconds" value={value.revealSeconds} onChange={(n) => set("revealSeconds", n)} min={L.revealSeconds.min} max={L.revealSeconds.max} />
          <NumberField label="Leaderboard" suffix="seconds" value={value.leaderboardSeconds} onChange={(n) => set("leaderboardSeconds", n)} min={L.leaderboardSeconds.min} max={L.leaderboardSeconds.max} />
          <NumberField label="Maximum players" value={value.maxPlayers} onChange={(n) => set("maxPlayers", n)} min={L.maxPlayers.min} max={L.maxPlayers.max} />
        </div>
      </details>
    </div>
  );
}
