import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { legal } from "@/lib/legal";

/** A plain, readable page for legal text (privacy policy, terms, support). */
export function LegalPage({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  return (
    <div className="bg-white">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/" aria-label="Home">
          <Logo />
        </Link>
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Home
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink-subtle">Last updated {legal.updated}</p>
        {intro && <p className="mt-6 text-base leading-7 text-ink-muted">{intro}</p>}
        <div className="mt-8 space-y-4">{children}</div>
      </main>
      <footer className="border-t border-line">
        <nav className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2 px-6 py-6 text-sm text-ink-subtle" aria-label="Legal">
          <Link href="/privacy" className="hover:text-ink">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-ink">Terms of Use</Link>
          <Link href="/support" className="hover:text-ink">Support</Link>
        </nav>
      </footer>
    </div>
  );
}

export const H2 = ({ children }: { children: ReactNode }) => (
  <h2 className="pt-6 text-xl font-semibold tracking-tight text-ink">{children}</h2>
);
export const P = ({ children }: { children: ReactNode }) => <p className="text-base leading-7 text-ink-muted">{children}</p>;
export const UL = ({ children }: { children: ReactNode }) => (
  <ul className="list-disc space-y-2 pl-6 text-base leading-7 text-ink-muted">{children}</ul>
);
export const Mail = () => (
  <a className="font-medium text-primary underline" href={`mailto:${legal.supportEmail}`}>
    {legal.supportEmail}
  </a>
);
