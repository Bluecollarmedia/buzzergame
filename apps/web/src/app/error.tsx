"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ level: "error", event: "ui.unhandled", digest: error.digest, message: error.message }));
  }, [error]);
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-ink-muted">Try again. If it keeps happening, refresh the page.</p>
      {error.digest && <p className="mt-1 font-mono text-xs text-ink-subtle">Reference: {error.digest}</p>}
      <button onClick={reset} className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">
        Try again
      </button>
    </main>
  );
}
