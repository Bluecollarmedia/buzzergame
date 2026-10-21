"use client";

import Link from "next/link";
import { KeyRound } from "lucide-react";
import type { EntitlementStatus } from "@crowdquiz/shared";
import { formatDateTime } from "@/lib/format";
import { buttonClasses } from "@/components/ui/Button";

export function AccessSummary({ ent }: { ent: EntitlementStatus | null }) {
  if (!ent) return null;
  if (ent.isAdmin && !ent.expiresAt) {
    return <p className="text-sm text-ink-muted">Administrator: hosting is always available.</p>;
  }
  if (!ent.active) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-ink">Hosting access isn&apos;t active</p>
          <p className="text-sm text-ink-muted">You can build quizzes now. Redeem an access code to launch live games.</p>
        </div>
        <Link href="/account/redeem" className={buttonClasses("primary", "sm")}>
          <KeyRound className="size-4" aria-hidden /> Redeem a code
        </Link>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium text-ink">Hosting access active</p>
        <p className="text-sm text-ink-muted">
          Until {formatDateTime(ent.expiresAt)}
          {ent.maxSessions ? ` · ${ent.sessionsUsed} of ${ent.maxSessions} games used` : ""}
        </p>
      </div>
      <Link href="/account/redeem" className="text-sm text-primary hover:underline">
        Add more time
      </Link>
    </div>
  );
}
