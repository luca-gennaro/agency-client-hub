import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Loader2, Plus, X } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentUserQuery, useCurrentUser } from "@/lib/current-user";
import { displayName, teamQuery } from "@/lib/crm";
import { permissions } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "Team — Clientbook" },
      { name: "description", content: "Your company's team members and invites." },
      { property: "og:title", content: "Team — Clientbook" },
      { property: "og:description", content: "Your company's team members and invites." },
    ],
  }),
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(currentUserQuery),
      context.queryClient.ensureQueryData(teamQuery),
    ]),
  component: TeamPage,
});

function TeamPage() {
  const me = useCurrentUser();
  const { data: team } = useSuspenseQuery(teamQuery);

  return (
    <AppShell>
      <PageHeader
        title="Team"
        description={`${team.length} ${team.length === 1 ? "person" : "people"} at ${me.company.name}.`}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border bg-card shadow-card">
          <ul className="divide-y">
            {team.map((m) => (
              <li key={m.id} className="flex items-center gap-4 px-5 py-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-lg text-secondary-foreground">
                  {(m.full_name || m.email).charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">
                    {displayName(m)}
                    {m.id === me.id && <span className="text-muted-foreground"> (you)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.email} · joined {format(new Date(m.created_at), "d MMM yyyy")}
                  </p>
                </div>
                <Badge variant={m.role === "admin" ? "default" : "secondary"} className="rounded-full">
                  {m.role === "admin" ? "Admin" : "Member"}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
        {permissions.inviteMembers(me.role) ? (
          <InvitesPanel />
        ) : (
          <section className="rounded-xl border bg-card p-5 text-sm text-muted-foreground shadow-card">
            Need to add a colleague? Ask an admin on your team for an invite code.
          </section>
        )}
      </div>
    </AppShell>
  );
}

type Invite = {
  id: string;
  code: string;
  created_at: string;
  used_at: string | null;
  user: { full_name: string; email: string } | null;
};

function InvitesPanel() {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState<string | null>(null);

  const invites = useQuery({
    queryKey: ["invites"],
    queryFn: async (): Promise<Invite[]> => {
      const { data, error } = await supabase
        .from("invites")
        .select("id, code, created_at, used_at, user:profiles!invites_used_by_fkey(full_name, email)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Invite[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("invites").insert({ created_by: me.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invite code created");
      queryClient.invalidateQueries({ queryKey: ["invites"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invites"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  async function copy(code: string) {
    const link = `${window.location.origin}/auth?mode=signup&invite=${code}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(code);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.message("Invite link", { description: link });
    }
  }

  const pending = (invites.data ?? []).filter((i) => !i.used_at);
  const used = (invites.data ?? []).filter((i) => i.used_at);

  return (
    <section className="rounded-xl border bg-card shadow-card">
      <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div>
          <h2 className="font-semibold">Invite members</h2>
          <p className="text-xs text-muted-foreground">
            Each code can be used once. New people join as members.
          </p>
        </div>
        <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          New code
        </Button>
      </div>
      <div className="p-5">
        {invites.isLoading ? (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        ) : pending.length === 0 ? (
          <div className="py-6 text-center">
            <KeyRound className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">No open invite codes.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {pending.map((inv) => (
              <li
                key={inv.id}
                className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2"
              >
                <code className="flex-1 font-mono text-sm tracking-widest">{inv.code}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copy(inv.code)}
                  aria-label={`Copy invite link for ${inv.code}`}
                >
                  {copied === inv.code ? <Check /> : <Copy />}
                  {copied === inv.code ? "Copied" : "Copy link"}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Revoke ${inv.code}`}
                  onClick={() => revoke.mutate(inv.id)}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
        {used.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Used
            </p>
            <ul className="space-y-1.5 text-sm">
              {used.slice(0, 8).map((inv) => (
                <li key={inv.id} className="flex justify-between gap-3 text-muted-foreground">
                  <span className="font-mono text-xs line-through">{inv.code}</span>
                  <span className="truncate text-xs">
                    {inv.user ? displayName(inv.user) : "Removed user"} ·{" "}
                    {format(new Date(inv.used_at!), "d MMM")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
