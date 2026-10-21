"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { LIMITS, errorMessage, passwordSchema, type EntitlementStatus } from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";
import { useApi } from "@/lib/useApi";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Alert, Card, PageHeader, PageSpinner } from "@/components/ui/Misc";
import { useToast } from "@/components/ui/Toast";
import { AccessSummary } from "@/components/host/AccessBanner";

const profileSchema = z.object({ displayName: z.string().trim().min(1, "Enter your name").max(LIMITS.hostDisplayName) });
const pwSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

interface Redemption {
  id: string;
  redeemed_at: string;
}
interface Entitlement {
  id: string;
  plan: string;
  starts_at: string;
  expires_at: string;
  status: string;
  source: string;
}

export function AccountSettings() {
  const api = useApi();
  const toast = useToast();
  const [email, setEmail] = useState<string>("");
  const [ent, setEnt] = useState<EntitlementStatus | null>(null);
  const [history, setHistory] = useState<Entitlement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [now] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const profile = useForm<z.infer<typeof profileSchema>>({ resolver: zodResolver(profileSchema) });
  const pw = useForm<z.infer<typeof pwSchema>>({ resolver: zodResolver(pwSchema) });

  useEffect(() => {
    const sb = getSupabase();
    (async () => {
      try {
        const { data: u } = await sb.auth.getUser();
        setEmail(u.user?.email ?? "");
        const [{ data: p }, e, { data: h }] = await Promise.all([
          sb.from("profiles").select("display_name").eq("id", u.user!.id).maybeSingle(),
          api.myEntitlement(),
          sb.from("entitlements").select("id, plan, starts_at, expires_at, status, source").order("expires_at", { ascending: false }).limit(20),
        ]);
        profile.reset({ displayName: p?.display_name ?? "" });
        setEnt(e);
        setHistory((h ?? []) as Entitlement[]);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const saveProfile = profile.handleSubmit(async ({ displayName }) => {
    const sb = getSupabase();
    const { data: u } = await sb.auth.getUser();
    const { error } = await sb.from("profiles").update({ display_name: displayName }).eq("id", u.user!.id);
    if (error) toast("error", errorMessage(error));
    else toast("success", "Profile saved");
  });

  const savePassword = pw.handleSubmit(async ({ password }) => {
    const { error } = await getSupabase().auth.updateUser({ password });
    if (error) toast("error", "Couldn't update your password. Try signing in again first.");
    else {
      pw.reset({ password: "", confirm: "" });
      toast("success", "Password updated");
    }
  });

  if (!loaded) return <PageSpinner />;
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Account" />
      {error && <Alert>{error}</Alert>}
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">Hosting access</h2>
        <AccessSummary ent={ent} />
        {history.length > 0 && (
          <ul className="mt-4 divide-y divide-line border-t border-line text-sm">
            {history.map((h) => (
              <li key={h.id} className="flex justify-between gap-2 py-2">
                <span className="capitalize text-ink-muted">{h.source.replace("_", " ")} · {h.plan}</span>
                <span className={h.status !== "active" || Date.parse(h.expires_at) < now ? "text-ink-subtle line-through" : ""}>
                  {formatDateTime(h.starts_at)} – {formatDateTime(h.expires_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">Profile</h2>
        <form onSubmit={saveProfile} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" value={email} disabled />
          </Field>
          <Field label="Display name" htmlFor="displayName" error={profile.formState.errors.displayName?.message}>
            <Input id="displayName" {...profile.register("displayName")} />
          </Field>
          <Button type="submit" loading={profile.formState.isSubmitting}>
            Save profile
          </Button>
        </form>
      </Card>
      <Card className="p-5">
        <h2 className="mb-4 font-semibold">Change password</h2>
        <form onSubmit={savePassword} className="space-y-4">
          <Field label="New password" htmlFor="password" error={pw.formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" {...pw.register("password")} />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm" error={pw.formState.errors.confirm?.message}>
            <Input id="confirm" type="password" autoComplete="new-password" {...pw.register("confirm")} />
          </Field>
          <Button type="submit" loading={pw.formState.isSubmitting}>
            Update password
          </Button>
        </form>
      </Card>
    </div>
  );
}

export type { Redemption };
