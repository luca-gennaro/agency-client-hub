import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/lib/current-user";
import { displayName, teamQuery, type ClientRow } from "@/lib/crm";
import { STATUS_OPTIONS, type ClientStatus } from "@/lib/status";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const UNASSIGNED = "__unassigned__";

type FormState = {
  name: string;
  email: string;
  phone: string;
  status: ClientStatus;
  owner: string;
  notes: string;
};

export function ClientFormDialog({
  open,
  onOpenChange,
  client,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: ClientRow;
  onSaved?: (id: string) => void;
}) {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const team = useQuery({ ...teamQuery, enabled: open });
  const [form, setForm] = useState<FormState>(() => initial(client, me.id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial(client, me.id));
      setError(null);
    }
  }, [open, client, me.id]);

  const save = useMutation({
    mutationFn: async (values: FormState) => {
      const payload = {
        name: values.name.trim(),
        email: values.email.trim(),
        phone: values.phone.trim(),
        status: values.status,
        notes: values.notes,
        owner_id: values.owner === UNASSIGNED ? null : values.owner,
      };
      if (client) {
        const { error } = await supabase.from("clients").update(payload).eq("id", client.id);
        if (error) throw error;
        return client.id;
      }
      const { data, error } = await supabase.from("clients").insert(payload).select("id").single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: async (id) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["clients"] }),
        queryClient.invalidateQueries({ queryKey: ["client", id] }),
      ]);
      toast.success(client ? "Client updated" : "Client added");
      onOpenChange(false);
      onSaved?.(id);
    },
    onError: (e: Error) => setError(e.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError("Name is required.");
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return setError("That email address doesn't look right.");
    }
    save.mutate(form);
  }

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl font-normal">
            {client ? "Edit client" : "New client"}
          </DialogTitle>
          <DialogDescription>
            {client ? "Update details for this client." : "Add a client to your company's book."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="client-name">Name</Label>
            <Input
              id="client-name"
              required
              maxLength={200}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="client-email">Email</Label>
              <Input
                id="client-email"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-phone">Phone</Label>
              <Input
                id="client-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as ClientStatus)}>
                <SelectTrigger aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Owner</Label>
              <Select value={form.owner} onValueChange={(v) => set("owner", v)}>
                <SelectTrigger aria-label="Owner">
                  <SelectValue placeholder="Choose a team member" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {(team.data ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {displayName(m)}
                      {m.id === me.id ? " (you)" : ""}
                    </SelectItem>
                  ))}
                  {form.owner !== UNASSIGNED &&
                    team.data &&
                    !team.data.some((m) => m.id === form.owner) && (
                      <SelectItem value={form.owner}>
                        {client?.owner ? displayName(client.owner) : "Current owner"}
                      </SelectItem>
                    )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="client-notes">Notes</Label>
            <Textarea
              id="client-notes"
              rows={4}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />}
              {client ? "Save changes" : "Add client"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function initial(client: ClientRow | undefined, myId: string): FormState {
  return {
    name: client?.name ?? "",
    email: client?.email ?? "",
    phone: client?.phone ?? "",
    status: client?.status ?? "lead",
    owner: client ? (client.owner_id ?? UNASSIGNED) : myId,
    notes: client?.notes ?? "",
  };
}
