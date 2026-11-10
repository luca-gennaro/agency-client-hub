import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { format } from "date-fns";
import { AppShell, PageHeader } from "@/components/app-shell";
import { ClientFormDialog } from "@/components/client-form-dialog";
import { ExportClientsButton } from "@/components/export-button";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { currentUserQuery } from "@/lib/current-user";
import { clientsQuery, displayName, statusCountsQuery } from "@/lib/crm";
import { STATUS_OPTIONS, type ClientStatus } from "@/lib/status";
import { cn } from "@/lib/utils";

type ClientsSearch = { q?: string | undefined; status?: ClientStatus | undefined };

export const Route = createFileRoute("/_authenticated/clients")({
  validateSearch: (search: Record<string, unknown>): ClientsSearch => ({
    q: typeof search["q"] === "string" && search["q"] ? search["q"] : undefined,
    status:
      search["status"] === "lead" || search["status"] === "active" || search["status"] === "lost"
        ? search["status"]
        : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Clients — Clientbook" },
      { name: "description", content: "Search and filter every client in your agency." },
      { property: "og:title", content: "Clients — Clientbook" },
      { property: "og:description", content: "Search and filter every client in your agency." },
    ],
  }),
  loaderDeps: ({ search }) => ({
    q: search.q ?? "",
    status: (search.status ?? "all") as ClientStatus | "all",
  }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(currentUserQuery),
      context.queryClient.ensureQueryData(statusCountsQuery),
      context.queryClient.ensureQueryData(
        clientsQuery({ search: deps.q, status: deps.status }),
      ),
    ]),
  component: ClientsPage,
});

function ClientsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/clients" });
  const status: ClientStatus | "all" = search.status ?? "all";
  const [term, setTerm] = useState(search.q ?? "");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? "") !== term.trim()) {
        navigate({ search: (prev) => ({ ...prev, q: term.trim() || undefined }), replace: true });
      }
    }, 250);
    return () => clearTimeout(t);
  }, [term, search.q, navigate]);

  const filters = { search: search.q ?? "", status };
  const clients = useQuery({ ...clientsQuery(filters), placeholderData: keepPreviousData });
  const counts = useQuery(statusCountsQuery);

  const tabs: { value: ClientStatus | "all"; label: string; count?: number | undefined }[] = [
    { value: "all", label: "All", count: counts.data?.total },
    ...STATUS_OPTIONS.map((s) => ({ ...s, count: counts.data?.[s.value] })),
  ];

  const rows = clients.data ?? [];

  return (
    <AppShell>
      <PageHeader
        title="Clients"
        description="Everyone your agency is talking to, working with, or has worked with."
        actions={
          <>
            <ExportClientsButton />
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add client
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex gap-1 rounded-lg border bg-card p-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={status === t.value}
              onClick={() =>
                navigate({
                  search: (prev) => ({
                    ...prev,
                    status: t.value === "all" ? undefined : t.value,
                  }),
                })
              }
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                status === t.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t.label}
              {t.count !== undefined && (
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    status === t.value ? "text-primary-foreground/75" : "text-muted-foreground",
                  )}
                >
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="relative md:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search clients"
            placeholder="Search name, email or phone"
            className="bg-card pl-9"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {clients.isFetching && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-semibold">Name</th>
                <th className="hidden px-5 py-3 font-semibold md:table-cell">Phone</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="hidden px-5 py-3 font-semibold sm:table-cell">Owner</th>
                <th className="hidden px-5 py-3 font-semibold lg:table-cell">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.id} className="group relative transition-colors hover:bg-muted/50">
                  <td className="px-5 py-3.5">
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: c.id }}
                      className="font-medium after:absolute after:inset-0"
                    >
                      {c.name}
                    </Link>
                    {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                  </td>
                  <td className="hidden px-5 py-3.5 text-muted-foreground md:table-cell">
                    {c.phone || "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="hidden px-5 py-3.5 sm:table-cell">{displayName(c.owner)}</td>
                  <td className="hidden px-5 py-3.5 text-muted-foreground lg:table-cell">
                    {format(new Date(c.updated_at), "d MMM yyyy")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && !clients.isLoading && (
          <div className="px-5 py-14 text-center">
            <p className="font-display text-2xl">No clients found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {search.q || search.status
                ? "Try a different search or status."
                : "Add your first client to get started."}
            </p>
          </div>
        )}
      </div>

      <ClientFormDialog
        open={adding}
        onOpenChange={setAdding}
        onSaved={(id) => navigate({ to: "/clients/$clientId", params: { clientId: id } })}
      />
    </AppShell>
  );
}
