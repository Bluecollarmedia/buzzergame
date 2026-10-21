"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, MoreHorizontal, Pencil, Play, Plus, Search, Trash2 } from "lucide-react";
import { GAME_MODE_INFO, errorMessage, type GameMode } from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";
import { useApi } from "@/lib/useApi";
import type { QuizRow } from "@/lib/types";
import { plural, relativeTime } from "@/lib/format";
import { Button, buttonClasses } from "@/components/ui/Button";
import { inputClass } from "@/components/ui/Field";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Alert, Badge, Card, EmptyState, PageHeader, PageSpinner } from "@/components/ui/Misc";
import { useToast } from "@/components/ui/Toast";
import { LaunchDialog } from "./LaunchDialog";

type Sort = "updated" | "created" | "title";

export function QuizLibrary() {
  const api = useApi();
  const toast = useToast();
  const router = useRouter();
  const [rows, setRows] = useState<QuizRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("updated");
  const [mode, setMode] = useState<GameMode | "all">("all");
  const [toDelete, setToDelete] = useState<QuizRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [launching, setLaunching] = useState<QuizRow | null>(null);
  const [menu, setMenu] = useState<string | null>(null);

  useEffect(() => {
    getSupabase()
      .from("quizzes")
      .select("*, questions(count)")
      .order("updated_at", { ascending: false })
      .then(({ data, error }) => (error ? setError(errorMessage(error)) : setRows(data as QuizRow[])));
  }, []);

  const visible = useMemo(() => {
    if (!rows) return [];
    const term = q.trim().toLowerCase();
    return rows
      .filter((r) => (mode === "all" || r.mode === mode) && (!term || r.title.toLowerCase().includes(term) || (r.description ?? "").toLowerCase().includes(term)))
      .sort((a, b) =>
        sort === "title" ? a.title.localeCompare(b.title) : sort === "created" ? b.created_at.localeCompare(a.created_at) : b.updated_at.localeCompare(a.updated_at),
      );
  }, [rows, q, sort, mode]);

  const duplicate = async (r: QuizRow) => {
    setMenu(null);
    try {
      const id = await api.duplicateQuiz(r.id);
      toast("success", "Quiz duplicated");
      router.push(`/quizzes/${id}`);
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    const { error } = await getSupabase().from("quizzes").delete().eq("id", toDelete.id);
    setDeleting(false);
    if (error) return toast("error", errorMessage(error));
    setRows((rs) => rs?.filter((x) => x.id !== toDelete.id) ?? null);
    setToDelete(null);
    toast("success", "Quiz deleted");
  };

  return (
    <div>
      <PageHeader
        title="Quizzes"
        description="Your saved quizzes. Only you can see them."
        actions={
          <Link href="/quizzes/new" className={buttonClasses("primary")}>
            <Plus className="size-4" aria-hidden /> Create a game
          </Link>
        }
      />
      {error && <Alert className="mb-4">{error}</Alert>}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search quizzes</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search quizzes" className={`${inputClass} h-10 pl-9`} />
        </label>
        <select aria-label="Filter by mode" value={mode} onChange={(e) => setMode(e.target.value as GameMode | "all")} className={`${inputClass} h-10 sm:w-48`}>
          <option value="all">All modes</option>
          <option value="multiple_choice">Multiple Choice</option>
          <option value="color_buzzer">Color Buzzer</option>
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${inputClass} h-10 sm:w-48`}>
          <option value="updated">Recently edited</option>
          <option value="created">Newest</option>
          <option value="title">Title A–Z</option>
        </select>
      </div>

      {!rows ? (
        <PageSpinner />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Plus className="size-5" />}
          title="No quizzes yet"
          description="Create a quiz to get started. You can save it as a draft and come back any time."
          action={
            <Link href="/quizzes/new" className={buttonClasses("primary")}>
              Create a game
            </Link>
          }
        />
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-ink-muted">No quizzes match your search.</p>
      ) : (
        <Card className="divide-y divide-line">
          {visible.map((r) => {
            const count = r.questions?.[0]?.count ?? 0;
            return (
              <div key={r.id} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/quizzes/${r.id}`} className="font-medium hover:underline">
                    {r.title}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                    <Badge tone={r.status === "ready" ? "success" : "neutral"}>{r.status === "ready" ? "Ready" : "Draft"}</Badge>
                    <span>{GAME_MODE_INFO[r.mode].name}</span>
                    <span aria-hidden>·</span>
                    <span>{plural(count, "question")}</span>
                    <span aria-hidden>·</span>
                    <span>Edited {relativeTime(r.updated_at)}</span>
                  </div>
                </div>
                <Button size="sm" onClick={() => setLaunching(r)} disabled={count === 0} icon={<Play className="size-3.5" aria-hidden />}>
                  Launch
                </Button>
                <div className="relative">
                  <Button variant="ghost" size="sm" aria-label={`More actions for ${r.title}`} aria-expanded={menu === r.id} onClick={() => setMenu(menu === r.id ? null : r.id)}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                  {menu === r.id && (
                    <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-line bg-white py-1 shadow-lg" role="menu">
                      <Link role="menuitem" href={`/quizzes/${r.id}`} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                        <Pencil className="size-4" aria-hidden /> Edit
                      </Link>
                      <button role="menuitem" onClick={() => duplicate(r)} className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50">
                        <Copy className="size-4" aria-hidden /> Duplicate
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenu(null);
                          setToDelete(r);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-red-50"
                      >
                        <Trash2 className="size-4" aria-hidden /> Delete
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <ConfirmDialog
        open={!!toDelete}
        onCancel={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        destructive
        title="Delete quiz?"
        confirmLabel="Delete quiz"
        body={
          <>
            <strong>{toDelete?.title}</strong> and its questions will be permanently deleted. Results of games you already
            played are kept.
          </>
        }
      />
      {launching && <LaunchDialog quiz={launching} onClose={() => setLaunching(null)} />}
    </div>
  );
}
