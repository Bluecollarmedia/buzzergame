"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Hand, Timer } from "lucide-react";
import { GAME_MODE_INFO, LIMITS, errorMessage, type GameMode } from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";
import { useApi } from "@/lib/useApi";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Alert, PageHeader } from "@/components/ui/Misc";
import { cn } from "@/components/ui/cn";

const NEW_QUIZ_KEY = "crowdquiz:new-quiz-form";

export function NewQuiz() {
  const router = useRouter();
  const api = useApi();
  const [mode, setMode] = useState<GameMode | null>(null);
  const [title, setTitle] = useState("");
  const [loaded, setLoaded] = useState(false);

  // Keep the half-filled form if the page is closed before "Create". Read after
  // mount, since the server render can't see this browser's storage.
  useEffect(() => {
    let saved: { mode?: GameMode | null; title?: string } | null = null;
    try {
      saved = JSON.parse(window.localStorage.getItem(NEW_QUIZ_KEY) ?? "null");
    } catch {
      /* ignore */
    }
    /* eslint-disable react-hooks/set-state-in-effect */
    if (saved?.title) setTitle(saved.title);
    if (saved?.mode) setMode(saved.mode);
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      if (title || mode) window.localStorage.setItem(NEW_QUIZ_KEY, JSON.stringify({ mode, title }));
      else window.localStorage.removeItem(NEW_QUIZ_KEY);
    } catch {
      /* ignore */
    }
  }, [loaded, mode, title]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mode) return setError("Choose a game mode.");
    if (!title.trim()) return setError("Give your quiz a title.");
    setBusy(true);
    setError(null);
    const sb = getSupabase();
    const { data: user } = await sb.auth.getUser();
    const { data, error } = await sb
      .from("quizzes")
      .insert({ owner_id: user.user?.id, title: title.trim(), mode })
      .select("id")
      .single();
    if (error || !data) {
      setBusy(false);
      return setError(errorMessage(error));
    }
    try {
      window.localStorage.removeItem(NEW_QUIZ_KEY);
    } catch {
      /* ignore */
    }
    try {
      await api.addQuestion(data.id);
    } catch {
      /* the editor offers "Add question" anyway */
    }
    router.replace(`/quizzes/${data.id}`);
  };

  return (
    <form onSubmit={create} className="mx-auto max-w-2xl">
      <PageHeader title="Create a game" description="Choose how people will play. You can add questions next." />
      {error && <Alert className="mb-4">{error}</Alert>}
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Game mode</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["multiple_choice", "color_buzzer"] as const).map((m) => (
            <label
              key={m}
              className={cn(
                "cursor-pointer rounded-card border bg-white p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                mode === m ? "border-primary ring-1 ring-primary" : "border-line hover:border-slate-300",
              )}
            >
              <input type="radio" name="mode" value={m} className="sr-only" checked={mode === m} onChange={() => setMode(m)} />
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                {m === "multiple_choice" ? <Timer className="size-5" aria-hidden /> : <Hand className="size-5" aria-hidden />}
              </div>
              <p className="mt-3 font-semibold">{GAME_MODE_INFO[m].name}</p>
              <p className="mt-1 text-sm text-ink-muted">{GAME_MODE_INFO[m].summary}</p>
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="Quiz title" htmlFor="title" className="mt-6">
        <Input id="title" value={title} maxLength={LIMITS.quizTitle} onChange={(e) => setTitle(e.target.value)} placeholder="Friday night trivia" />
      </Field>
      <div className="mt-6 flex justify-end">
        <Button type="submit" loading={busy}>
          Create and add questions
        </Button>
      </div>
    </form>
  );
}
