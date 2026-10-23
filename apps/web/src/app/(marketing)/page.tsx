import Link from "next/link";
import { ArrowRight, Hand, ListChecks, MonitorPlay, QrCode, ShieldCheck, Smartphone, Timer, Trophy } from "lucide-react";
import { ANSWER_COLORS, brand } from "@crowdquiz/shared";
import { Logo } from "@/components/ui/Logo";
import { buttonClasses } from "@/components/ui/Button";

export default function LandingPage() {
  return (
    <div className="bg-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/join" className={buttonClasses("ghost", "sm")}>
            Join a game
          </Link>
          <Link href="/login" className={buttonClasses("ghost", "sm")}>
            Sign in
          </Link>
          <Link href="/signup" className={buttonClasses("primary", "sm")}>
            Create account
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-2 lg:pt-16">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            Live trivia on the big screen. Every phone is a buzzer.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-muted">
            Build a quiz in minutes, put it on a projector, and let the room play. Players scan a QR code and answer on
            their phones. No accounts, no app required.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={buttonClasses("primary", "lg")}>
              Host a game <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link href="/join" className={buttonClasses("secondary", "lg")}>
              I have a room code
            </Link>
          </div>
        </div>

        <div aria-hidden className="relative">
          <div className="rounded-2xl bg-stage p-6 shadow-2xl ring-1 ring-black/5">
            <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-white/50">
              <span>Question 4 of 10</span>
              <span className="rounded-full bg-white/10 px-2 py-1 text-white">0:09</span>
            </div>
            <p className="mt-6 text-2xl font-semibold text-white">Which planet has the shortest day?</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {["Mars", "Jupiter", "Earth", "Venus"].map((t, i) => (
                <div key={t} className="flex items-center gap-3 rounded-xl px-4 py-4 text-white" style={{ background: ANSWER_COLORS[i]!.bg }}>
                  <span className="grid size-7 place-items-center rounded-md bg-black/20 text-sm font-bold">{ANSWER_COLORS[i]!.label}</span>
                  <span className="font-medium">{t}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="absolute -bottom-8 -right-2 hidden w-36 rounded-[1.75rem] border-[6px] border-ink bg-ink p-2 shadow-xl sm:block">
            <div className="grid grid-cols-2 gap-1.5">
              {ANSWER_COLORS.map((c) => (
                <div key={c.label} className="grid aspect-square place-items-center rounded-lg text-lg font-bold text-white" style={{ background: c.bg }}>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-surface-muted">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-2xl font-semibold tracking-tight">Two ways to play</h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            <ModeCard
              icon={<Timer className="size-5" />}
              title="Multiple Choice"
              text="Timed questions on the projector. Everyone answers A, B, C or D before the clock runs out. The correct answer and leaderboard appear automatically, then the next question starts."
            />
            <ModeCard
              icon={<Hand className="size-5" />}
              title="Color Buzzer"
              text="Four coloured buttons on every phone match the four answers on screen. Press the right colour first to win the point. A wrong press locks you out of that question."
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="mt-8 grid gap-6 md:grid-cols-4">
          <Step n={1} icon={<ListChecks className="size-5" />} title="Write your quiz" text="Add questions with four answers and mark the correct one." />
          <Step n={2} icon={<MonitorPlay className="size-5" />} title="Open the projector" text="Launch a game and show the projector view full screen." />
          <Step n={3} icon={<QrCode className="size-5" />} title="Players scan" text="Phones scan the QR code, enter a name and they're in." />
          <Step n={4} icon={<Trophy className="size-5" />} title="Play and crown a winner" text="Scores are calculated on the server and shown live." />
        </ol>
        <div className="mt-12 grid gap-4 rounded-card border border-line p-6 sm:grid-cols-3">
          <Feature icon={<Smartphone className="size-4" />} text="Works in any phone browser, or the native app" />
          <Feature icon={<ShieldCheck className="size-4" />} text="Fair timing decided by the server, not the phone" />
          <Feature icon={<Trophy className="size-4" />} text="Results saved so you can look back later" />
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 py-6 text-sm text-ink-subtle sm:flex-row">
          <Logo className="text-sm" />
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-1" aria-label="Legal">
            <Link href="/privacy" className="hover:text-ink">Privacy</Link>
            <Link href="/terms" className="hover:text-ink">Terms</Link>
            <Link href="/support" className="hover:text-ink">Support</Link>
          </nav>
          <span>{brand.tagline}</span>
        </div>
      </footer>
    </div>
  );
}

function ModeCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-card border border-line bg-white p-6">
      <div className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">{icon}</div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-ink-muted">{text}</p>
    </div>
  );
}

function Step({ n, icon, title, text }: { n: number; icon: React.ReactNode; title: string; text: string }) {
  return (
    <li>
      <div className="flex items-center gap-2 text-primary">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Step {n}</span>
      </div>
      <h3 className="mt-2 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-ink-muted">{text}</p>
    </li>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-muted">
      <span className="text-primary">{icon}</span>
      {text}
    </div>
  );
}
