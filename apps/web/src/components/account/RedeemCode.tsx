"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, KeyRound } from "lucide-react";
import { errorMessage } from "@crowdquiz/shared";
import { useApi } from "@/lib/useApi";
import { formatDateTime } from "@/lib/format";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Alert, Card, PageHeader } from "@/components/ui/Misc";

export function RedeemCode() {
  const api = useApi();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ startsAt: string; expiresAt: string; redeemedAt: number } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return setError("Enter your access code.");
    setBusy(true);
    setError(null);
    try {
      const r = await api.redeemAccessCode(code);
      setDone({ ...r, redeemedAt: Date.now() });
      setCode("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg">
      <PageHeader title="Redeem an access code" description="Access codes unlock hosting live games for a period of time." />
      <Card className="p-5">
        {done ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto size-10 text-green-600" aria-hidden />
            <p className="mt-3 font-semibold">Code redeemed</p>
            <p className="mt-1 text-sm text-ink-muted">
              {Date.parse(done.startsAt) > done.redeemedAt + 60000
                ? `This access starts when your current access ends, on ${formatDateTime(done.startsAt)}, and lasts until ${formatDateTime(done.expiresAt)}.`
                : `You can host games until ${formatDateTime(done.expiresAt)}.`}
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <Link href="/quizzes" className={buttonClasses("primary")}>
                Go to quizzes
              </Link>
              <Button variant="secondary" onClick={() => setDone(null)}>
                Redeem another
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {error && <Alert>{error}</Alert>}
            <Field label="Access code" htmlFor="code" hint="Codes are not case-sensitive. Dashes are optional.">
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="ABCD-EFGH-JKLM"
                className="font-mono uppercase tracking-wider"
              />
            </Field>
            <Button type="submit" loading={busy} icon={<KeyRound className="size-4" aria-hidden />}>
              Redeem
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
