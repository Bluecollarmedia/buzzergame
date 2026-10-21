"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Shield } from "lucide-react";
import { getSupabase } from "@/lib/supabase/client";
import { Logo } from "@/components/ui/Logo";
import { cn } from "@/components/ui/cn";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/quizzes", label: "Quizzes" },
  { href: "/sessions", label: "Games" },
  { href: "/account", label: "Account" },
];

export function HostNav({ displayName, isAdmin }: { displayName: string; isAdmin: boolean }) {
  const path = usePathname();
  const router = useRouter();
  const signOut = async () => {
    await getSupabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  };
  const all = isAdmin ? [...links, { href: "/admin", label: "Admin" }] : links;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/dashboard" aria-label="Dashboard">
          <Logo />
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto" aria-label="Main">
          {all.map((l) => {
            const active = path === l.href || path.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active ? "bg-slate-100 text-ink" : "text-ink-muted hover:text-ink",
                )}
              >
                {l.href === "/admin" && <Shield className="size-3.5" aria-hidden />}
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden text-sm text-ink-muted md:block">{displayName}</div>
        <button onClick={signOut} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-ink-muted hover:bg-slate-100 hover:text-ink">
          <LogOut className="size-4" aria-hidden />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}
