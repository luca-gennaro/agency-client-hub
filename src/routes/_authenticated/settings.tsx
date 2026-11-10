import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell, PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { currentUserQuery, useCurrentUser } from "@/lib/current-user";
import { permissions } from "@/lib/permissions";

const settingsQuery = queryOptions({
  queryKey: ["company-settings"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("company_settings")
      .select("billing_notes, updated_at")
      .maybeSingle();
    if (error) throw error;
    return data ?? { billing_notes: "", updated_at: null as string | null };
  },
});

export const Route = createFileRoute("/_authenticated/settings")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(currentUserQuery);
    if (!permissions.viewCompanySettings(me.role)) throw redirect({ to: "/dashboard" });
  },
  head: () => ({
    meta: [
      { title: "Company settings — Clientbook" },
      { name: "description", content: "Company name and billing notes for admins." },
      { property: "og:title", content: "Company settings — Clientbook" },
      { property: "og:description", content: "Company name and billing notes for admins." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(settingsQuery),
  component: SettingsPage,
});

function SettingsPage() {
  const me = useCurrentUser();
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.company.name);
  const [notes, setNotes] = useState(settings.billing_notes);

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Company name can't be empty.");
      const [a, b] = await Promise.all([
        supabase.from("companies").update({ name: trimmed }).eq("id", me.company.id),
        supabase
          .from("company_settings")
          .update({ billing_notes: notes })
          .eq("company_id", me.company.id),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["current-user"] }),
        queryClient.invalidateQueries({ queryKey: ["company-settings"] }),
      ]);
      toast.success("Settings saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <AppShell>
      <PageHeader title="Company settings" description="Only admins can see this page." />
      <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
        <section className="rounded-xl border bg-card p-6 shadow-card">
          <div className="space-y-2">
            <Label htmlFor="company-name">Company name</Label>
            <Input
              id="company-name"
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </section>
        <section className="rounded-xl border bg-card p-6 shadow-card">
          <div className="mb-4 flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-primary" />
            <div>
              <Label htmlFor="billing-notes" className="text-base">
                Billing notes
              </Label>
              <p className="text-xs text-muted-foreground">
                Private to admins — plan details, payment terms, VAT numbers, renewal dates.
              </p>
            </div>
          </div>
          <Textarea
            id="billing-notes"
            rows={10}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Invoices due net 30. Retainer renews every January."
          />
          {settings.updated_at && (
            <p className="mt-2 text-xs text-muted-foreground">
              Last saved {format(new Date(settings.updated_at), "d MMM yyyy, HH:mm")}
            </p>
          )}
        </section>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" />}
          Save settings
        </Button>
      </form>
    </AppShell>
  );
}
