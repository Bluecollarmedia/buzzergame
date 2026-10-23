"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, ArrowDown, ArrowLeft, ArrowUp, Check, CheckCircle2, CloudOff, Copy, Eye, Loader2, Play, Plus, Settings2, Trash2,
} from "lucide-react";
import {
  ANSWER_COLORS, GAME_MODE_INFO, LIMITS, errorMessage, normalizeSessionSettings, questionIssues, validateQuizForPlay,
  type SessionSettings,
} from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";
import { useApi } from "@/lib/useApi";
import type { QuestionRow, QuizRow } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Alert, Badge, PageSpinner } from "@/components/ui/Misc";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/components/ui/cn";
import { QuestionStage } from "@/components/game/QuestionStage";
import { LaunchDialog } from "../LaunchDialog";
import { SettingsForm } from "../SettingsForm";
import { useAutosave, type SaveStatus } from "./useAutosave";
import { applyBackup, clearBackup, readBackup, writeBackup, type LocalBackup } from "./localBackup";

const toDraft = (q: QuestionRow) => ({ prompt: q.prompt, choices: q.choices, correctIndex: q.correct_index });

export function QuizEditor({ quizId }: { quizId: string }) {
  const api = useApi();
  const toast = useToast();
  const [quiz, setQuiz] = useState<QuizRow | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [toDelete, setToDelete] = useState<QuestionRow | null>(null);
  const [readyError, setReadyError] = useState<string | null>(null);

  const fetchQuiz = useCallback(async () => {
    const sb = getSupabase();
    const [qz, qs] = await Promise.all([
      sb.from("quizzes").select("*").eq("id", quizId).maybeSingle(),
      sb.from("questions").select("*").eq("quiz_id", quizId).order("position"),
    ]);
    if (qz.error || qs.error) throw new Error(errorMessage(qz.error ?? qs.error));
    if (!qz.data) throw new Error("This quiz doesn't exist or you don't have access to it.");
    return { quiz: qz.data as QuizRow, rows: (qs.data ?? []) as QuestionRow[] };
  }, [quizId]);

  const apply = useCallback((d: { quiz: QuizRow; rows: QuestionRow[] }, keepSelection: boolean) => {
    setQuiz(d.quiz);
    setQuestions(d.rows);
    setSelected((cur) => (keepSelection && cur && d.rows.some((r) => r.id === cur) ? cur : d.rows[0]?.id ?? null));
  }, []);

  const load = useCallback(async () => apply(await fetchQuiz(), true), [apply, fetchQuiz]);


  // ---- Autosave -----------------------------------------------------------
  const save = useCallback(
    async (keys: Set<string>) => {
      const sb = getSupabase();
      const jobs: Array<PromiseLike<{ error: unknown }>> = [];
      if (keys.has("meta") && quiz) {
        jobs.push(sb.from("quizzes").update({ title: quiz.title.trim() || "Untitled quiz", description: quiz.description || null }).eq("id", quiz.id));
      }
      if (keys.has("settings") && quiz) {
        jobs.push(sb.from("quizzes").update({ settings: quiz.settings }).eq("id", quiz.id));
      }
      for (const q of questions) {
        if (keys.has(q.id)) {
          jobs.push(
            sb.from("questions").update({
              prompt: q.prompt,
              choices: q.choices,
              correct_index: q.correct_index,
              time_limit_seconds: q.time_limit_seconds,
            }).eq("id", q.id),
          );
        }
      }
      const results = await Promise.all(jobs);
      const failed = results.find((r) => r.error);
      if (failed) throw new Error(errorMessage(failed.error));
      // The server may have moved a 'ready' quiz back to draft.
      const { data } = await sb.from("quizzes").select("status, updated_at").eq("id", quizId).maybeSingle();
      if (data) setQuiz((cur) => (cur ? { ...cur, ...data } : cur));
    },
    [quiz, questions, quizId],
  );
  const autosave = useAutosave(save);
  const { markDirty, unsavedKeys } = autosave;

  // Edits from this device that never reached the server (lost signal, tab
  // closed mid-save) are put back on top of the server copy, then saved.
  useEffect(() => {
    fetchQuiz()
      .then((d) => {
        const keys = applyBackup(readBackup(quizId), d);
        for (const k of keys) markDirty(k);
        apply(d, false);
        if (keys.size) toast("success", "Restored changes that hadn't finished saving.");
        else clearBackup(quizId);
      })
      .catch((e: Error) => setLoadError(e.message));
    // Load once per quiz; toast and markDirty don't need to re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchQuiz, apply, quizId]);

  // Keep a copy of not-yet-saved edits in this browser until the server has them.
  useEffect(() => {
    if (!quiz) return;
    const keys = unsavedKeys();
    const backup: Omit<LocalBackup, "savedAt"> = { questions: {} };
    if (keys.has("meta")) backup.meta = { title: quiz.title, description: quiz.description };
    if (keys.has("settings")) backup.settings = quiz.settings;
    for (const q of questions) {
      if (keys.has(q.id)) {
        backup.questions[q.id] = { prompt: q.prompt, choices: q.choices, correct_index: q.correct_index, time_limit_seconds: q.time_limit_seconds };
      }
    }
    writeBackup(quiz.id, backup);
  }, [quiz, questions, autosave.status, unsavedKeys]);

  const updateQuestion = (id: string, patch: Partial<QuestionRow>) => {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
    autosave.markDirty(id);
  };
  const updateMeta = (patch: Partial<QuizRow>) => {
    setQuiz((q) => (q ? { ...q, ...patch } : q));
    autosave.markDirty("meta");
  };

  // ---- Structural changes (save pending edits first) -----------------------
  const structural = async (fn: () => Promise<unknown>, after?: (r: unknown) => void) => {
    setBusy(true);
    const ok = await autosave.flush();
    if (!ok) {
      setBusy(false);
      return toast("error", "Couldn't save your changes. Check your connection and try again.");
    }
    try {
      const r = await fn();
      await load();
      after?.(r);
    } catch (e) {
      toast("error", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const selectedIndex = questions.findIndex((q) => q.id === selected);
  const current = selectedIndex >= 0 ? questions[selectedIndex]! : null;

  const addQuestion = () =>
    structural(() => api.addQuestion(quizId, current ? current.position : null), (r) => setSelected((r as { id: string }).id));
  const duplicate = (q: QuestionRow) => structural(() => api.duplicateQuestion(q.id), (r) => setSelected((r as { id: string }).id));
  const remove = async () => {
    if (!toDelete) return;
    const idx = questions.findIndex((q) => q.id === toDelete.id);
    const nextSel = questions[idx + 1]?.id ?? questions[idx - 1]?.id ?? null;
    await structural(() => api.deleteQuestion(toDelete.id), () => setSelected(nextSel));
    setToDelete(null);
  };
  const move = (q: QuestionRow, dir: -1 | 1) => {
    const idx = questions.findIndex((x) => x.id === q.id);
    const to = idx + dir;
    if (to < 0 || to >= questions.length) return;
    const ids = questions.map((x) => x.id);
    [ids[idx], ids[to]] = [ids[to]!, ids[idx]!];
    setQuestions((qs) => ids.map((id, i) => ({ ...qs.find((x) => x.id === id)!, position: i })));
    void structural(() => api.reorderQuestions(quizId, ids));
  };

  const issues = useMemo(() => validateQuizForPlay(questions.map(toDraft)), [questions]);

  const markReady = async (ready: boolean) => {
    setReadyError(null);
    if (!(await autosave.flush())) return;
    const { error } = await getSupabase().from("quizzes").update({ status: ready ? "ready" : "draft" }).eq("id", quizId);
    if (error) return setReadyError(errorMessage(error));
    setQuiz((q) => (q ? { ...q, status: ready ? "ready" : "draft" } : q));
    toast("success", ready ? "Quiz marked as ready" : "Quiz moved back to draft");
  };

  const saveSettings = (s: SessionSettings) => {
    setQuiz((q) => (q ? { ...q, settings: s as unknown as Record<string, unknown> } : q));
    autosave.markDirty("settings");
  };

  if (loadError) {
    return (
      <div className="space-y-4">
        <Alert>{loadError}</Alert>
        <Link href="/quizzes" className="text-sm text-primary hover:underline">
          Back to quizzes
        </Link>
      </div>
    );
  }
  if (!quiz) return <PageSpinner label="Loading quiz" />;

  const settings = normalizeSessionSettings(quiz.mode, quiz.settings);

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <Link href="/quizzes" className="mb-2 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> Quizzes
          </Link>
          <label htmlFor="quiz-title" className="sr-only">
            Quiz title
          </label>
          <input
            id="quiz-title"
            value={quiz.title}
            maxLength={LIMITS.quizTitle}
            onChange={(e) => updateMeta({ title: e.target.value })}
            className="w-full rounded-md bg-transparent px-1 text-2xl font-semibold tracking-tight outline-none hover:bg-white focus:bg-white focus:ring-2 focus:ring-primary/30"
          />
          <div className="mt-1 flex flex-wrap items-center gap-2 px-1 text-sm text-ink-muted">
            <Badge tone="primary">{GAME_MODE_INFO[quiz.mode].name}</Badge>
            <Badge tone={quiz.status === "ready" ? "success" : "neutral"}>{quiz.status === "ready" ? "Ready" : "Draft"}</Badge>
            <SaveIndicator status={autosave.status} error={autosave.error} onRetry={() => void autosave.flush()} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setSettingsOpen(true)} icon={<Settings2 className="size-4" aria-hidden />}>
            Settings
          </Button>
          {quiz.status === "draft" ? (
            <Button variant="secondary" onClick={() => markReady(true)} disabled={issues.length > 0} title={issues[0]} icon={<Check className="size-4" aria-hidden />}>
              Mark ready
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => markReady(false)}>
              Back to draft
            </Button>
          )}
          <Button
            onClick={async () => {
              if (await autosave.flush()) setLaunchOpen(true);
            }}
            disabled={issues.length > 0}
            title={issues[0]}
            icon={<Play className="size-4" aria-hidden />}
          >
            Launch
          </Button>
        </div>
      </div>

      {readyError && <Alert className="mb-4">{readyError}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Question list */}
        <aside>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Questions ({questions.length})</h2>
            {busy && <Loader2 className="size-4 animate-spin text-ink-subtle" aria-label="Working" />}
          </div>
          <ol className="space-y-1.5" aria-label="Questions">
            {questions.map((q, i) => {
              const bad = questionIssues(toDraft(q), i).length > 0;
              return (
                <li key={q.id}>
                  <button
                    onClick={() => setSelected(q.id)}
                    aria-current={q.id === selected ? "true" : undefined}
                    className={cn(
                      "flex w-full items-start gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                      q.id === selected ? "border-primary bg-primary-soft" : "border-line bg-white hover:border-slate-300",
                    )}
                  >
                    <span className="mt-0.5 w-5 shrink-0 text-xs font-semibold text-ink-subtle">{i + 1}</span>
                    <span className={cn("line-clamp-2 flex-1", !q.prompt.trim() && "italic text-ink-subtle")}>{q.prompt.trim() || "Untitled question"}</span>
                    {bad ? (
                      <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-label="Incomplete" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" aria-label="Complete" />
                    )}
                  </button>
                </li>
              );
            })}
          </ol>
          <Button variant="secondary" className="mt-3 w-full" onClick={addQuestion} disabled={busy || questions.length >= LIMITS.maxQuestions} icon={<Plus className="size-4" aria-hidden />}>
            Add question
          </Button>
          {issues.length > 0 && questions.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">Before you can launch</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {issues.slice(0, 5).map((m) => (
                  <li key={m}>{m}</li>
                ))}
                {issues.length > 5 && <li>and {issues.length - 5} more</li>}
              </ul>
            </div>
          )}
        </aside>

        {/* Question editor */}
        <section>
          {!current ? (
            <div className="rounded-card border border-dashed border-line bg-white px-6 py-16 text-center">
              <p className="font-medium">No questions yet</p>
              <p className="mt-1 text-sm text-ink-muted">Add your first question to get started.</p>
              <Button className="mt-4" onClick={addQuestion} icon={<Plus className="size-4" aria-hidden />}>
                Add question
              </Button>
            </div>
          ) : (
            <div className="rounded-card border border-line bg-white p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold">Question {selectedIndex + 1}</h2>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => move(current, -1)} disabled={busy || selectedIndex === 0} aria-label="Move question up">
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => move(current, 1)} disabled={busy || selectedIndex === questions.length - 1} aria-label="Move question down">
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => duplicate(current)} disabled={busy} icon={<Copy className="size-4" aria-hidden />}>
                    Duplicate
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setToDelete(current)} disabled={busy} icon={<Trash2 className="size-4" aria-hidden />} className="text-danger hover:text-danger">
                    Delete
                  </Button>
                  <Button variant={preview ? "secondary" : "ghost"} size="sm" onClick={() => setPreview((p) => !p)} icon={<Eye className="size-4" aria-hidden />} aria-pressed={preview}>
                    Preview
                  </Button>
                </div>
              </div>

              <Field label="Question" htmlFor="prompt" hint={`${current.prompt.length}/${LIMITS.prompt}. Shown on the projector only.`}>
                <Textarea
                  id="prompt"
                  value={current.prompt}
                  maxLength={LIMITS.prompt}
                  placeholder="Type your question"
                  onChange={(e) => updateQuestion(current.id, { prompt: e.target.value })}
                  className="text-base"
                />
              </Field>

              <fieldset className="mt-5">
                <legend className="mb-2 text-sm font-medium">Answers — select the correct one</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ANSWER_COLORS.map((c, i) => {
                    const correct = current.correct_index === i;
                    return (
                      <div key={c.label} className={cn("flex items-center gap-2 rounded-lg border p-2", correct ? "border-green-600 ring-1 ring-green-600" : "border-line")}>
                        <span className="grid size-9 shrink-0 place-items-center rounded-md text-sm font-bold text-white" style={{ background: c.bg }} aria-hidden>
                          {c.label}
                        </span>
                        <label className="sr-only" htmlFor={`choice-${i}`}>
                          Answer {c.label} ({c.name})
                        </label>
                        <input
                          id={`choice-${i}`}
                          value={current.choices[i] ?? ""}
                          maxLength={LIMITS.choice}
                          placeholder={`Answer ${c.label}`}
                          onChange={(e) => {
                            const choices = [...current.choices] as QuestionRow["choices"];
                            choices[i] = e.target.value;
                            updateQuestion(current.id, { choices });
                          }}
                          className="min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-ink-subtle"
                        />
                        <label className={cn("flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs font-medium", correct ? "bg-green-50 text-green-700" : "text-ink-subtle hover:bg-slate-50")}>
                          <input
                            type="radio"
                            name={`correct-${current.id}`}
                            checked={correct}
                            onChange={() => updateQuestion(current.id, { correct_index: i })}
                            className="accent-green-600"
                          />
                          Correct
                        </label>
                      </div>
                    );
                  })}
                </div>
              </fieldset>

              {quiz.mode === "multiple_choice" && (
                <div className="mt-5 flex flex-wrap items-end gap-3">
                  <Field label="Timer for this question" htmlFor="qtime" hint={`Leave empty to use the game default (${settings.timeLimitSeconds}s).`}>
                    <Input
                      id="qtime"
                      type="number"
                      min={5}
                      max={120}
                      placeholder={`${settings.timeLimitSeconds}`}
                      value={current.time_limit_seconds ?? ""}
                      onChange={(e) => {
                        const v = e.target.value === "" ? null : Math.max(5, Math.min(120, Math.round(Number(e.target.value))));
                        updateQuestion(current.id, { time_limit_seconds: v });
                      }}
                      className="w-32"
                    />
                  </Field>
                </div>
              )}

              {preview && (
                <div className="mt-6">
                  <p className="mb-2 text-sm font-medium text-ink-muted">Projector preview</p>
                  <div className="aspect-video w-full overflow-hidden rounded-xl bg-stage p-[4%]">
                    <QuestionStage
                      prompt={current.prompt}
                      choices={current.choices}
                      mode={quiz.mode}
                      questionLabel={`Question ${selectedIndex + 1} of ${questions.length}`}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-6">
            <Field label="Description (optional)" htmlFor="desc" hint="Only you see this.">
              <Textarea id="desc" value={quiz.description ?? ""} maxLength={LIMITS.quizDescription} onChange={(e) => updateMeta({ description: e.target.value })} />
            </Field>
          </div>
        </section>
      </div>

      <ConfirmDialog
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={remove}
        loading={busy}
        destructive
        title="Delete question?"
        confirmLabel="Delete"
        body="This question will be removed from the quiz."
      />
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Default game settings" wide footer={<Button onClick={() => setSettingsOpen(false)}>Done</Button>}>
        <p className="mb-4 text-sm text-ink-muted">These are used every time you launch this quiz. You can still change them at launch.</p>
        <SettingsForm mode={quiz.mode} value={settings} onChange={saveSettings} />
      </Dialog>
      {launchOpen && <LaunchDialog quiz={quiz} onClose={() => setLaunchOpen(false)} />}
    </div>
  );
}

function SaveIndicator({ status, error, onRetry }: { status: SaveStatus; error: string | null; onRetry: () => void }) {
  if (status === "saving")
    return (
      <span className="inline-flex items-center gap-1 text-ink-subtle" role="status">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Saving
      </span>
    );
  if (status === "saved")
    return (
      <span className="inline-flex items-center gap-1 text-green-700" role="status">
        <Check className="size-3.5" aria-hidden /> All changes saved
      </span>
    );
  if (status === "error")
    return (
      <span className="inline-flex items-center gap-1 text-danger" role="alert">
        <CloudOff className="size-3.5" aria-hidden /> Not saved{error ? `: ${error}` : ""}.{" "}
        <button onClick={onRetry} className="font-medium underline">
          Retry
        </button>
      </span>
    );
  return null;
}
