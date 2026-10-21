"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createGameApi, errorMessage, normalizeRoomCode } from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";

export function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = normalizeRoomCode(code);
    if (c.length !== 6) return setError("Room codes have 6 letters and numbers.");
    setBusy(true);
    setError(null);
    try {
      const r = await createGameApi(getSupabase()).resolveRoomCode(c);
      router.push(`/j/${r.joinToken}`);
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
    }
  };
  return (
    <div className="flex min-h-dvh flex-col bg-stage px-5 py-8 text-white">
      <Logo inverted />
      <form onSubmit={submit} className="mx-auto mt-16 w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Join a game</h1>
        <p className="mt-1 text-white/60">Enter the room code shown on the screen.</p>
        <label htmlFor="code" className="sr-only">
          Room code
        </label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
          maxLength={8}
          placeholder="ABC 123"
          className="mt-6 h-16 w-full rounded-xl border-2 border-white/15 bg-white/5 text-center font-mono text-3xl tracking-[0.3em] text-white placeholder:text-white/20 focus:border-white/60 focus:outline-none"
        />
        {error && (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="mt-6 w-full" loading={busy}>
          Continue
        </Button>
      </form>
    </div>
  );
}
