"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Check, Copy, KeyRound, Plus, RefreshCw, Search } from "lucide-react";
import {
  errorMessage, type AdminAccessCode, type AdminAuditEntry, type AdminHost, type AdminSession, type AppSettings,
} from "@crowdquiz/shared";
import { useApi } from "@/lib/useApi";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/Button";
import { Field, Input, inputClass } from "@/components/ui/Field";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Alert, Badge, Card, PageHeader, PageSpinner } from "@/components/ui/Misc";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/components/ui/cn";

type Tab = "overview" | "hosts" | "codes" | "sessions" | "audit";

export function AdminConsole() {
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: Array<[Tab, string]> = [
    ["overview", "Overview"],
    ["hosts", "Hosts"],
    ["codes", "Access codes"],
    ["sessions", "Games"],
    ["audit", "Audit log"],
  ];
  return (
    <div>
      <PageHeader title="Administration" description="Manage hosts, access codes and live games." />
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium", tab === id ? "border-primary text-ink" : "border-transparent text-ink-muted hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "hosts" && <Hosts />}
      {tab === "codes" && <Codes />}
      {tab === "sessions" && <Sessions />}
      {tab === "audit" && <Audit />}
    </div>
  );
}

function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  const reload = useCallback(() => {
    fnRef.current().then((d) => {
      setError(null);
      setData(d);
    }).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    fnRef.current().then(setData).catch((e) => setError(errorMessage(e)));
  }, []);
  return { data, error, reload, setData };
}

function Overview() {
  const api = useApi();
  const { data, error, reload } = useLoad(() => api.admin.overview());
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <PageSpinner />;
  const items: Array<[string, string | number, string?]> = [
    ["Hosts", data.hosts!],
    ["Hosts with active access", data.activeEntitlements!],
    ["Disabled hosts", data.disabledHosts!],
    ["Live games", data.liveSessions!],
    ["Games in last 24h", data.sessions24h!],
    ["Players in last 24h", data.players24h!],
    ["Active access codes", data.activeCodes!],
    ["Stalled games", data.stalledSessions!, Number(data.stalledSessions) > 0 ? "Games whose timer passed more than 30s ago without advancing. Check that the scheduler is running." : undefined],
  ];
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant="secondary" size="sm" onClick={reload} icon={<RefreshCw className="size-3.5" aria-hidden />}>
          Refresh
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([label, value, warn]) => (
          <Card key={label} className={cn("p-4", warn && "border-amber-300")}>
            <p className="text-sm text-ink-muted">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            {warn && <p className="mt-1 text-xs text-amber-800">{warn}</p>}
          </Card>
        ))}
      </div>
      <p className="mt-4 text-xs text-ink-subtle">Server time {formatDateTime(String(data.serverNow))}</p>
      <Switches />
    </div>
  );
}

function Switches() {
  const api = useApi();
  const toast = useToast();
  const { data, error, setData } = useLoad<AppSettings>(() => api.admin.getSettings());
  const [busy, setBusy] = useState<keyof AppSettings | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return null;

  const flip = async (key: "freeHosting" | "photoUploads", on: boolean, msg: string) => {
    setBusy(key);
    try {
      setData(await api.admin.updateSettings({ [key]: on }));
      toast("success", msg);
    } catch (e) {
      toast("error", errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const rows: Array<{ key: "freeHosting" | "photoUploads"; title: string; on: string; off: string }> = [
    {
      key: "freeHosting",
      title: "Free hosting",
      on: "On: anyone signed in can host games without an access code.",
      off: "Off: hosting needs an access code or a grant from you.",
    },
    {
      key: "photoUploads",
      title: "Photo uploads",
      on: "On: hosts can add photos to questions (10 on free accounts, 200 with hosting access).",
      off: "Off: nobody can upload new photos. Photos already on quizzes still show.",
    },
  ];

  return (
    <Card className="mt-6 divide-y divide-line">
      {rows.map((r) => {
        const on = data[r.key];
        return (
          <div key={r.key} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 font-medium text-ink">
                {r.title} <Badge tone={on ? "success" : "neutral"}>{on ? "On" : "Off"}</Badge>
              </p>
              <p className="text-sm text-ink-muted">{on ? r.on : r.off}</p>
            </div>
            <Button
              variant={on ? "secondary" : "primary"}
              size="sm"
              loading={busy === r.key}
              disabled={busy !== null}
              onClick={() => void flip(r.key, !on, `${r.title} turned ${on ? "off" : "on"}`)}
            >
              Turn {on ? "off" : "on"}
            </Button>
          </div>
        );
      })}
    </Card>
  );
}

function Hosts() {
  const api = useApi();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const { data, error, setData } = useLoad<AdminHost[]>(() => api.admin.listHosts(""));
  const reload = () => {
    api.admin.listHosts(search).then(setData).catch((e) => toast("error", errorMessage(e)));
  };
  const [grant, setGrant] = useState<AdminHost | null>(null);
  const [hours, setHours] = useState(24 * 7);
  const [disable, setDisable] = useState<AdminHost | null>(null);
  const [now] = useState(() => Date.now());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const doSearch = (e: React.FormEvent) => {
    e.preventDefault();
    reload();
  };
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast("success", msg);
      reload();
    } catch (e) {
      toast("error", errorMessage(e));
    } finally {
      setBusy(false);
      setGrant(null);
      setDisable(null);
    }
  };

  return (
    <div>
      <form onSubmit={doSearch} className="mb-4 flex gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search hosts</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by email or name" className={`${inputClass} h-10 pl-9`} />
        </label>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      {error && <Alert>{error}</Alert>}
      {!data ? (
        <PageSpinner />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wider text-ink-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Host</th>
                <th className="px-4 py-2 font-medium">Access until</th>
                <th className="px-4 py-2 font-medium">Quizzes / games</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((h) => (
                <tr key={h.id}>
                  <td className="px-4 py-2">
                    <p className="font-medium">{h.displayName || "—"}</p>
                    <p className="text-ink-muted">{h.email}</p>
                  </td>
                  <td className="px-4 py-2">{h.isAdmin ? <Badge tone="primary">Admin</Badge> : h.accessExpiresAt ? formatDateTime(h.accessExpiresAt) : <span className="text-ink-subtle">None</span>}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {h.quizCount} / {h.sessionCount}
                  </td>
                  <td className="px-4 py-2">{h.disabled ? <Badge tone="danger">Disabled</Badge> : <Badge tone="success">Active</Badge>}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setGrant(h)}>
                      Grant access
                    </Button>
                    {h.disabled ? (
                      <Button variant="ghost" size="sm" onClick={() => act(() => api.admin.setHostDisabled(h.id, false), "Host enabled")}>
                        Enable
                      </Button>
                    ) : (
                      !h.isAdmin && (
                        <Button variant="ghost" size="sm" className="text-danger" onClick={() => setDisable(h)}>
                          Disable
                        </Button>
                      )
                    )}
                    {h.accessExpiresAt && Date.parse(h.accessExpiresAt) > now && (
                      <Button variant="ghost" size="sm" onClick={() => act(() => api.admin.revokeEntitlements(h.id), "Access revoked")}>
                        Revoke access
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Dialog
        open={!!grant}
        onClose={() => setGrant(null)}
        title={`Grant access to ${grant?.email ?? ""}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setGrant(null)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => grant && act(() => api.admin.grantEntitlement(grant.id, hours), "Access granted")}>
              Grant
            </Button>
          </>
        }
      >
        <Field label="Duration (hours)" htmlFor="hours" hint="24 = one day, 168 = one week, 720 = 30 days.">
          <Input id="hours" type="number" min={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={!!disable}
        onCancel={() => setDisable(null)}
        onConfirm={() => disable && act(() => api.admin.setHostDisabled(disable.id, true, reason || undefined), "Host disabled")}
        loading={busy}
        destructive
        title="Disable this host?"
        confirmLabel="Disable host"
        body={
          <div className="space-y-3">
            <p>{disable?.email} won&apos;t be able to launch games, and their live games will be cancelled.</p>
            <Input aria-label="Reason (optional)" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        }
      />
    </div>
  );
}

function Codes() {
  const api = useApi();
  const toast = useToast();
  const { data, error, reload } = useLoad<AdminAccessCode[]>(() => api.admin.listAccessCodes());
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [form, setForm] = useState({ durationHours: 24 * 7, maxRedemptions: 1, expiresAt: "", note: "", maxSessions: "", code: "" });
  const [busy, setBusy] = useState(false);
  const [revoke, setRevoke] = useState<AdminAccessCode | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const r = await api.admin.createAccessCode({
        durationHours: form.durationHours,
        maxRedemptions: form.maxRedemptions,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        note: form.note || null,
        maxSessions: form.maxSessions ? Number(form.maxSessions) : null,
        code: form.code || null,
      });
      setCreated(r.code);
      setOpen(false);
      reload();
    } catch (e) {
      toast("error", errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const presets: Array<[string, number]> = [
    ["1 day", 24],
    ["7 days", 168],
    ["30 days", 720],
  ];

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setOpen(true)} icon={<Plus className="size-4" aria-hidden />}>
          New access code
        </Button>
      </div>
      {created && (
        <Alert tone="success" className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              New code: <code className="font-mono text-base font-semibold">{created}</code>. Copy it now; it won&apos;t be shown again.
            </span>
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy className="size-3.5" aria-hidden />}
              onClick={async () => {
                await navigator.clipboard.writeText(created).catch(() => {});
                toast("success", "Copied");
              }}
            >
              Copy
            </Button>
          </div>
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      {!data ? (
        <PageSpinner />
      ) : data.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-white p-8 text-center text-sm text-ink-muted">No access codes yet.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-left text-xs uppercase tracking-wider text-ink-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Grants</th>
                <th className="px-4 py-2 font-medium">Used</th>
                <th className="px-4 py-2 font-medium">Expires</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2">
                    <span className="font-mono">{c.hint}…</span>
                    {c.note && <p className="text-xs text-ink-muted">{c.note}</p>}
                  </td>
                  <td className="px-4 py-2">
                    {c.durationHours % 24 === 0 ? `${c.durationHours / 24} days` : `${c.durationHours} hours`}
                    {c.maxSessions ? ` · ${c.maxSessions} games` : ""}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {c.redemptionCount} / {c.maxRedemptions}
                  </td>
                  <td className="px-4 py-2">{c.expiresAt ? formatDateTime(c.expiresAt) : "Never"}</td>
                  <td className="px-4 py-2">
                    <Badge tone={c.status === "active" ? "success" : c.status === "revoked" ? "danger" : "neutral"}>{c.status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-right">
                    {c.status === "active" && (
                      <Button variant="ghost" size="sm" className="text-danger" onClick={() => setRevoke(c)} icon={<Ban className="size-3.5" aria-hidden />}>
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="New access code"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={create} loading={busy} icon={<KeyRound className="size-4" aria-hidden />}>
              Create code
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-medium">Access length</p>
            <div className="flex flex-wrap gap-2">
              {presets.map(([label, h]) => (
                <Button key={label} size="sm" variant={form.durationHours === h ? "primary" : "secondary"} onClick={() => setForm({ ...form, durationHours: h })} icon={form.durationHours === h ? <Check className="size-3.5" /> : undefined}>
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <Field label="Or hours" htmlFor="dur">
            <Input id="dur" type="number" min={1} value={form.durationHours} onChange={(e) => setForm({ ...form, durationHours: Number(e.target.value) })} />
          </Field>
          <Field label="How many hosts can redeem it" htmlFor="max" hint="1 = single use.">
            <Input id="max" type="number" min={1} value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: Number(e.target.value) })} />
          </Field>
          <Field label="Code expires (optional)" htmlFor="exp" hint="After this date the code can't be redeemed.">
            <Input id="exp" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
          </Field>
          <Field label="Game limit (optional)" htmlFor="ms" hint="Maximum games the host can launch with this access.">
            <Input id="ms" type="number" min={1} value={form.maxSessions} onChange={(e) => setForm({ ...form, maxSessions: e.target.value })} />
          </Field>
          <Field label="Custom code (optional)" htmlFor="custom" hint="Leave empty to generate a random code.">
            <Input id="custom" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className="font-mono uppercase" />
          </Field>
          <Field label="Note (optional)" htmlFor="note">
            <Input id="note" value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
        </div>
      </Dialog>
      <ConfirmDialog
        open={!!revoke}
        onCancel={() => setRevoke(null)}
        onConfirm={async () => {
          if (!revoke) return;
          try {
            await api.admin.revokeAccessCode(revoke.id);
            toast("success", "Code revoked");
            reload();
          } catch (e) {
            toast("error", errorMessage(e));
          }
          setRevoke(null);
        }}
        destructive
        title="Revoke this code?"
        confirmLabel="Revoke"
        body="Nobody else will be able to redeem it. Access already granted with it is not affected."
      />
    </div>
  );
}

function Sessions() {
  const api = useApi();
  const toast = useToast();
  const [liveOnly, setLiveOnly] = useState(true);
  const { data, error, setData } = useLoad<AdminSession[]>(() => api.admin.listSessions(true));
  const [end, setEnd] = useState<AdminSession | null>(null);
  const load = (live: boolean) => {
    setLiveOnly(live);
    api.admin.listSessions(live).then(setData).catch((e) => toast("error", errorMessage(e)));
  };
  return (
    <div>
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={liveOnly ? "primary" : "secondary"} onClick={() => load(true)}>
          Live
        </Button>
        <Button size="sm" variant={!liveOnly ? "primary" : "secondary"} onClick={() => load(false)}>
          All recent
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {!data ? (
        <PageSpinner />
      ) : data.length === 0 ? (
        <p className="rounded-card border border-dashed border-line bg-white p-8 text-center text-sm text-ink-muted">No games.</p>
      ) : (
        <Card className="divide-y divide-line">
          {data.map((s) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.title}</p>
                <p className="text-ink-muted">
                  {s.hostEmail} · {formatDateTime(s.createdAt)} · {s.playerCount} players
                </p>
              </div>
              <Badge>{s.status}</Badge>
              {!["finished", "aborted"].includes(s.status) && (
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setEnd(s)}>
                  Stop game
                </Button>
              )}
            </div>
          ))}
        </Card>
      )}
      <ConfirmDialog
        open={!!end}
        onCancel={() => setEnd(null)}
        destructive
        title="Stop this game?"
        confirmLabel="Stop game"
        body="The game will be cancelled for the host and all players."
        onConfirm={async () => {
          if (!end) return;
          try {
            await api.admin.endSession(end.id);
            toast("success", "Game stopped");
            load(liveOnly);
          } catch (e) {
            toast("error", errorMessage(e));
          }
          setEnd(null);
        }}
      />
    </div>
  );
}

function Audit() {
  const api = useApi();
  const { data, error, reload } = useLoad<AdminAuditEntry[]>(() => api.admin.auditLog(200));
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <PageSpinner />;
  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button variant="secondary" size="sm" onClick={reload} icon={<RefreshCw className="size-3.5" aria-hidden />}>
          Refresh
        </Button>
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-muted text-left text-xs uppercase tracking-wider text-ink-subtle">
            <tr>
              <th className="px-4 py-2 font-medium">When</th>
              <th className="px-4 py-2 font-medium">Who</th>
              <th className="px-4 py-2 font-medium">Action</th>
              <th className="px-4 py-2 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="whitespace-nowrap px-4 py-2 text-ink-muted">{formatDateTime(e.createdAt)}</td>
                <td className="px-4 py-2">
                  <span className="text-ink-muted">{e.actorType}</span> {e.actorEmail ?? ""}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{e.action}</td>
                <td className="max-w-md truncate px-4 py-2 font-mono text-xs text-ink-muted" title={JSON.stringify(e.details)}>
                  {JSON.stringify(e.details)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
