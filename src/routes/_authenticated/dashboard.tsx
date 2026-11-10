import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { AppShell, PageHeader } from "@/components/app-shell";
import { ClientFormDialog } from "@/components/client-form-dialog";
import { ExportClientsButton } from "@/components/export-button";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { currentUserQuery, useCurrentUser } from "@/lib/current-user";
import { clientsQuery, displayName, statusCountsQuery } from "@/lib/crm";
import { STATUS_OPTIONS } from "@/lib/status";
import { cn } from "@/lib/utils";

const recentFilters = { search: "", status: "all" } as const;

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Clientbook" },
      { name: "description", content: "Your agency's clients at a glance, by status." },
      { property: "og:title", content: "Dashboard — Clientbook" },
      { property: "og:description", content: "Your agency's clients at a glance, by status." },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(currentUserQuery),
      context.queryClient.ensureQueryData(statusCountsQuery),
      context.queryClient.ensureQueryData(clientsQuery(recentFilters)),
    ]),
  component: Dashboard,
});

const barTone = {
  lead: "bg-status-lead",
  active: "bg-status-active",
  lost: "bg-status-lost",
} as const;

function Dashboard() {
  const me = useCurrentUser();
  const { data: counts } = useSuspenseQuery(statusCountsQuery);
  const { data: clients } = useSuspenseQuery(clientsQuery(recentFilters));
  const [adding, setAdding] = useState(false);
  const firstName = (me.fullName || me.email).split(" ")[0];

  return (
    <AppShell>
      <PageHeader
        title={`Hello, ${firstName}`}
        description={`Here's where ${me.company.name} stands today.`}
        actions={
          <>
            <ExportClientsButton />
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add client
            </Button>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-card p-5 shadow-card">
          <p className="text-sm text-muted-foreground">All clients</p>
          <p className="mt-2 font-display text-5xl">{counts.total}</p>
          <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-muted">
            {STATUS_OPTIONS.map((s) =>
              counts.total ? (
                <div
                  key={s.value}
                  className={barTone[s.value]}
                  style={{ width: `${(counts[s.value] / counts.total) * 100}%` }}
                />
              ) : null,
            )}
          </div>
        </div>
        {STATUS_OPTIONS.map((s) => (
          <Link
            key={s.value}
            to="/clients"
            search={{ status: s.value }}
            className="group rounded-xl border bg-card p-5 shadow-card transition-shadow hover:shadow-lift"
          >
            <div className="flex items-center justify-between">
              <StatusBadge status={s.value} />
              <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </div>
            <p className="mt-3 font-display text-5xl">{counts[s.value]}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {counts.total ? Math.round((counts[s.value] / counts.total) * 100) : 0}% of clients
            </p>
          </Link>
        ))}
      </section>

      <section className="mt-10 rounded-xl border bg-card shadow-card">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="font-semibold">Recently updated</h2>
          <Link to="/clients" className="text-sm font-medium text-primary hover:underline">
            View all
          </Link>
        </div>
        {clients.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="font-display text-2xl">No clients yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your first client to start building your book.
            </p>
            <Button className="mt-5" onClick={() => setAdding(true)}>
              <Plus /> Add client
            </Button>
          </div>
        ) : (
          <ul className="divide-y">
            {clients.slice(0, 6).map((c) => (
              <li key={c.id}>
                <Link
                  to="/clients/$clientId"
                  params={{ clientId: c.id }}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {displayName(c.owner)} · updated{" "}
                      {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}
                    </p>
                  </div>
                  <StatusBadge status={c.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ClientFormDialog open={adding} onOpenChange={setAdding} />
      <span className={cn("hidden")} />
    </AppShell>
  );
}
