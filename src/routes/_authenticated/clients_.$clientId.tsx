import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent } from "react";
import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { ClientFormDialog } from "@/components/client-form-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { currentUserQuery, useCurrentUser } from "@/lib/current-user";
import {
  clientQuery,
  displayName,
  documentsQuery,
  DOCUMENTS_BUCKET,
  formatBytes,
  type ClientDocument,
} from "@/lib/crm";
import { permissions } from "@/lib/permissions";

const MAX_BYTES = 20 * 1024 * 1024;

export const Route = createFileRoute("/_authenticated/clients_/$clientId")({
  loader: async ({ context, params }) => {
    const [, client] = await Promise.all([
      context.queryClient.ensureQueryData(currentUserQuery),
      context.queryClient.ensureQueryData(clientQuery(params.clientId)),
      context.queryClient.ensureQueryData(documentsQuery(params.clientId)),
    ]);
    if (!client) throw notFound();
    return { name: client.name };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.name} — Clientbook` : "Client — Clientbook" },
      { name: "description", content: "Client details, notes and documents." },
      { property: "og:title", content: "Client — Clientbook" },
      { property: "og:description", content: "Client details, notes and documents." },
    ],
  }),
  notFoundComponent: () => (
    <AppShell>
      <div className="py-20 text-center">
        <p className="font-display text-4xl">Client not found</p>
        <p className="mt-2 text-sm text-muted-foreground">
          It may have been deleted, or it belongs to another company.
        </p>
        <Button asChild className="mt-6" variant="outline">
          <Link to="/clients">Back to clients</Link>
        </Button>
      </div>
    </AppShell>
  ),
  component: ClientDetail,
});

function ClientDetail() {
  const { clientId } = Route.useParams();
  const me = useCurrentUser();
  const { data: client } = useSuspenseQuery(clientQuery(clientId));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const remove = useMutation({
    mutationFn: async () => {
      const { data: docs, error: docsError } = await supabase
        .from("client_documents")
        .select("storage_path")
        .eq("client_id", clientId);
      if (docsError) throw docsError;
      if (docs && docs.length) {
        const { error } = await supabase.storage
          .from(DOCUMENTS_BUCKET)
          .remove(docs.map((d) => d.storage_path));
        if (error) throw error;
      }
      const { error, count } = await supabase
        .from("clients")
        .delete({ count: "exact" })
        .eq("id", clientId);
      if (error) throw error;
      if (!count) throw new Error("Only admins can delete clients.");
    },
    onSuccess: async () => {
      toast.success("Client deleted");
      queryClient.removeQueries({ queryKey: ["client", clientId] });
      await queryClient.invalidateQueries({ queryKey: ["clients"] });
      navigate({ to: "/clients" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!client) return null;

  return (
    <AppShell>
      <Link
        to="/clients"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All clients
      </Link>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-4xl leading-tight sm:text-5xl">{client.name}</h1>
            <StatusBadge status={client.status} />
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Added {format(new Date(client.created_at), "d MMMM yyyy")} · last updated{" "}
            {format(new Date(client.updated_at), "d MMM yyyy, HH:mm")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil /> Edit
          </Button>
          {permissions.deleteClients(me.role) && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive hover:text-destructive">
                  <Trash2 /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {client.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the client and all of their documents. This can't be
                    undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => remove.mutate()}
                  >
                    Delete client
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="space-y-6">
          <div className="rounded-xl border bg-card p-5 shadow-card">
            <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Contact
            </h2>
            <dl className="space-y-3.5 text-sm">
              <Detail icon={Mail} label="Email">
                {client.email ? (
                  <a href={`mailto:${client.email}`} className="text-primary hover:underline">
                    {client.email}
                  </a>
                ) : (
                  "—"
                )}
              </Detail>
              <Detail icon={Phone} label="Phone">
                {client.phone ? (
                  <a href={`tel:${client.phone}`} className="hover:underline">
                    {client.phone}
                  </a>
                ) : (
                  "—"
                )}
              </Detail>
              <Detail icon={UserRound} label="Owner">
                {displayName(client.owner)}
              </Detail>
            </dl>
          </div>
          <div className="rounded-xl border bg-card p-5 shadow-card">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Notes
            </h2>
            {client.notes.trim() ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{client.notes}</p>
            ) : (
              <p className="text-sm text-muted-foreground">No notes yet.</p>
            )}
          </div>
        </section>

        <DocumentsPanel clientId={client.id} />
      </div>

      <ClientFormDialog open={editing} onOpenChange={setEditing} client={client} />
    </AppShell>
  );
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Mail;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="break-words">{children}</dd>
      </div>
    </div>
  );
}

function DocumentsPanel({ clientId }: { clientId: string }) {
  const me = useCurrentUser();
  const queryClient = useQueryClient();
  const { data: docs } = useSuspenseQuery(documentsQuery(clientId));
  const inputRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 20 MB.`);
        const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
        const path = `${me.company.id}/${clientId}/${crypto.randomUUID()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from(DOCUMENTS_BUCKET)
          .upload(path, file, { contentType: file.type || undefined });
        if (upErr) throw upErr;
        const { error: rowErr } = await supabase.from("client_documents").insert({
          client_id: clientId,
          file_name: file.name,
          storage_path: path,
          size_bytes: file.size,
          mime_type: file.type,
          uploaded_by: me.id,
        });
        if (rowErr) {
          await supabase.storage.from(DOCUMENTS_BUCKET).remove([path]);
          throw rowErr;
        }
      }
      return files.length;
    },
    onSuccess: (n) => {
      toast.success(n === 1 ? "Document uploaded" : `${n} documents uploaded`);
      queryClient.invalidateQueries({ queryKey: ["client-documents", clientId] });
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => {
      if (inputRef.current) inputRef.current.value = "";
    },
  });

  const remove = useMutation({
    mutationFn: async (doc: ClientDocument) => {
      const { error, count } = await supabase
        .from("client_documents")
        .delete({ count: "exact" })
        .eq("id", doc.id);
      if (error) throw error;
      if (!count) throw new Error("You can only delete documents you uploaded.");
      await supabase.storage.from(DOCUMENTS_BUCKET).remove([doc.storage_path]);
    },
    onSuccess: () => {
      toast.success("Document deleted");
      queryClient.invalidateQueries({ queryKey: ["client-documents", clientId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function download(doc: ClientDocument) {
    setDownloading(doc.id);
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(doc.storage_path, 60, { download: doc.file_name });
    setDownloading(null);
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't prepare the download");
      return;
    }
    window.location.assign(data.signedUrl);
  }

  function onFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length) upload.mutate(files);
  }

  return (
    <section className="rounded-xl border bg-card shadow-card">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div>
          <h2 className="font-semibold">Documents</h2>
          <p className="text-xs text-muted-foreground">Contracts, invoices and other files.</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg"
          onChange={onFiles}
          aria-label="Upload documents"
        />
        <Button size="sm" onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
          {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
          Upload
        </Button>
      </div>
      {docs.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="m-5 flex w-[calc(100%-2.5rem)] flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center transition-colors hover:border-primary hover:bg-accent/40"
        >
          <FileText className="size-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No documents yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Upload PDF contracts, invoices or proposals (up to 20 MB each).
          </p>
        </button>
      ) : (
        <ul className="divide-y">
          {docs.map((doc) => {
            const canDelete = doc.uploaded_by === me.id || me.role === "admin";
            return (
              <li key={doc.id} className="flex items-center gap-4 px-5 py-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                  <FileText className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{doc.file_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatBytes(doc.size_bytes)} · {displayName(doc.uploader)} ·{" "}
                    {format(new Date(doc.created_at), "d MMM yyyy")}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Download ${doc.file_name}`}
                  onClick={() => download(doc)}
                  disabled={downloading === doc.id}
                >
                  {downloading === doc.id ? <Loader2 className="animate-spin" /> : <Download />}
                </Button>
                {canDelete && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${doc.file_name}`}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (confirm(`Delete ${doc.file_name}?`)) remove.mutate(doc);
                    }}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
