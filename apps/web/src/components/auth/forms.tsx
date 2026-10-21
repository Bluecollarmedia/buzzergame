"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { emailSchema, passwordSchema, signInSchema, signUpSchema } from "@crowdquiz/shared";
import { getSupabase } from "@/lib/supabase/client";
import { siteBaseUrl } from "@/lib/env";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Alert } from "@/components/ui/Misc";

/** Only allow redirects to paths on this site. */
function safeNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}

function authErrorMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) return "That email and password don't match.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first. Check your inbox for the link.";
  if (/already registered|already exists/i.test(message)) return "An account with that email already exists. Try signing in.";
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  if (/fetch|network/i.test(message)) return "Connection problem. Check your internet and try again.";
  return "Something went wrong. Try again.";
}

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof signInSchema>>({ resolver: zodResolver(signInSchema) });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const { error } = await getSupabase().auth.signInWithPassword(v);
    if (error) return setError(authErrorMessage(error.message));
    router.replace(safeNext(params.get("next")));
    router.refresh();
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-sm text-ink-muted">Welcome back. Sign in to host games.</p>
      </div>
      {params.get("reset") === "1" && <Alert tone="success">Password updated. Sign in with your new password.</Alert>}
      {error && <Alert>{error}</Alert>}
      <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} aria-invalid={!!form.formState.errors.email} />
      </Field>
      <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" {...form.register("password")} aria-invalid={!!form.formState.errors.password} />
      </Field>
      <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
        Sign in
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-primary hover:underline">
          Forgot password?
        </Link>
        <Link href="/signup" className="text-ink-muted hover:text-ink">
          Create an account
        </Link>
      </div>
    </form>
  );
}

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<z.infer<typeof signUpSchema>>({ resolver: zodResolver(signUpSchema) });
  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    const { data, error } = await getSupabase().auth.signUp({
      email: v.email,
      password: v.password,
      options: {
        data: { display_name: v.displayName },
        emailRedirectTo: `${siteBaseUrl()}/auth/callback?next=/dashboard`,
      },
    });
    if (error) return setError(authErrorMessage(error.message));
    if (data.session) {
      router.replace("/dashboard");
      router.refresh();
    } else {
      setSentTo(v.email);
    }
  });
  if (sentTo) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Check your email</h1>
        <p className="text-sm text-ink-muted">
          We sent a confirmation link to <strong>{sentTo}</strong>. Open it to finish creating your account.
        </p>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-lg font-semibold">Create your host account</h1>
        <p className="text-sm text-ink-muted">Players never need an account.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      <Field label="Your name" htmlFor="displayName" error={form.formState.errors.displayName?.message}>
        <Input id="displayName" autoComplete="name" {...form.register("displayName")} aria-invalid={!!form.formState.errors.displayName} />
      </Field>
      <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} aria-invalid={!!form.formState.errors.email} />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 8 characters." error={form.formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} aria-invalid={!!form.formState.errors.password} />
      </Field>
      <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
        Create account
      </Button>
      <p className="text-center text-sm text-ink-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}

const forgotSchema = z.object({ email: emailSchema });

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof forgotSchema>>({ resolver: zodResolver(forgotSchema) });
  const onSubmit = form.handleSubmit(async ({ email }) => {
    setError(null);
    const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
      redirectTo: `${siteBaseUrl()}/auth/callback?next=/reset-password`,
    });
    // Same message whether or not the account exists (no account probing).
    if (error && /rate limit|fetch|network/i.test(error.message)) return setError(authErrorMessage(error.message));
    setSent(true);
  });
  if (sent) {
    return (
      <div className="space-y-3">
        <h1 className="text-lg font-semibold">Check your email</h1>
        <p className="text-sm text-ink-muted">If an account exists for that address, we&apos;ve sent a link to reset your password.</p>
        <Link href="/login" className="text-sm text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-lg font-semibold">Reset your password</h1>
        <p className="text-sm text-ink-muted">We&apos;ll email you a link to choose a new one.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
      </Field>
      <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
        Send reset link
      </Button>
      <Link href="/login" className="block text-center text-sm text-ink-muted hover:text-ink">
        Back to sign in
      </Link>
    </form>
  );
}

const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export function ResetPasswordForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });
  const onSubmit = form.handleSubmit(async ({ password }) => {
    setError(null);
    const sb = getSupabase();
    const { data } = await sb.auth.getUser();
    if (!data.user) return setError("Your reset link has expired. Request a new one.");
    const { error } = await sb.auth.updateUser({ password });
    if (error) return setError(authErrorMessage(error.message));
    await sb.auth.signOut();
    router.replace("/login?reset=1");
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div>
        <h1 className="text-lg font-semibold">Choose a new password</h1>
      </div>
      {error && (
        <Alert>
          {error}{" "}
          <Link href="/forgot-password" className="underline">
            Request a new link
          </Link>
        </Alert>
      )}
      <Field label="New password" htmlFor="password" error={form.formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm" error={form.formState.errors.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
      </Field>
      <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>
        Update password
      </Button>
    </form>
  );
}
