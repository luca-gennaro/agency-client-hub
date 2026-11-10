import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ClientStatus } from "@/lib/status";
import { STATUS_LABEL } from "@/lib/status";
import { downloadBlob, toCsv } from "@/lib/csv";
import { format } from "date-fns";

export type Owner = { id: string; full_name: string; email: string } | null;

export type ClientRow = {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: ClientStatus;
  notes: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  owner: Owner;
};

const CLIENT_SELECT =
  "id, name, email, phone, status, notes, owner_id, created_at, updated_at, owner:profiles!clients_owner_id_fkey(id, full_name, email)";

export type ClientFilters = { search: string; status: ClientStatus | "all" };

function cleanSearch(search: string) {
  return search.replace(/[,()*%\\]/g, " ").trim();
}

export const clientsQuery = (filters: ClientFilters) =>
  queryOptions({
    queryKey: ["clients", filters],
    queryFn: async (): Promise<ClientRow[]> => {
      let q = supabase.from("clients").select(CLIENT_SELECT).order("updated_at", {
        ascending: false,
      });
      if (filters.status !== "all") q = q.eq("status", filters.status);
      const s = cleanSearch(filters.search);
      if (s) q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`);
      const { data, error } = await q.limit(500);
      if (error) throw error;
      return (data ?? []) as unknown as ClientRow[];
    },
  });

export const clientQuery = (id: string) =>
  queryOptions({
    queryKey: ["client", id],
    queryFn: async (): Promise<ClientRow | null> => {
      const { data, error } = await supabase
        .from("clients")
        .select(CLIENT_SELECT)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as ClientRow | null;
    },
  });

export type StatusCounts = Record<ClientStatus, number> & { total: number };

export const statusCountsQuery = queryOptions({
  queryKey: ["clients", "status-counts"],
  queryFn: async (): Promise<StatusCounts> => {
    const statuses: ClientStatus[] = ["lead", "active", "lost"];
    const results = await Promise.all(
      statuses.map((status) =>
        supabase.from("clients").select("id", { count: "exact", head: true }).eq("status", status),
      ),
    );
    const counts = { lead: 0, active: 0, lost: 0, total: 0 } as StatusCounts;
    results.forEach((r, i) => {
      if (r.error) throw r.error;
      counts[statuses[i]] = r.count ?? 0;
    });
    counts.total = counts.lead + counts.active + counts.lost;
    return counts;
  },
});

export type TeamMember = {
  id: string;
  full_name: string;
  email: string;
  created_at: string;
  role: "admin" | "member";
};

export const teamQuery = queryOptions({
  queryKey: ["team"],
  queryFn: async (): Promise<TeamMember[]> => {
    const [profiles, roles] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, created_at").order("created_at"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (profiles.error) throw profiles.error;
    if (roles.error) throw roles.error;
    const admins = new Set(
      (roles.data ?? []).filter((r) => r.role === "admin").map((r) => r.user_id),
    );
    return (profiles.data ?? []).map((p) => ({
      ...p,
      role: admins.has(p.id) ? "admin" : "member",
    }));
  },
});

export type ClientDocument = {
  id: string;
  file_name: string;
  storage_path: string;
  size_bytes: number;
  mime_type: string;
  uploaded_by: string | null;
  created_at: string;
  uploader: { full_name: string; email: string } | null;
};

export const documentsQuery = (clientId: string) =>
  queryOptions({
    queryKey: ["client-documents", clientId],
    queryFn: async (): Promise<ClientDocument[]> => {
      const { data, error } = await supabase
        .from("client_documents")
        .select(
          "id, file_name, storage_path, size_bytes, mime_type, uploaded_by, created_at, uploader:profiles!client_documents_uploaded_by_fkey(full_name, email)",
        )
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ClientDocument[];
    },
  });

export const DOCUMENTS_BUCKET = "client-documents";

export function displayName(person: { full_name: string; email: string } | null | undefined) {
  if (!person) return "Unassigned";
  return person.full_name.trim() || person.email;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Fetch every client in the company (paged past the 1000-row limit) and download a CSV. */
export async function exportAllClients(companyName: string) {
  const pageSize = 1000;
  const all: ClientRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("clients")
      .select(CLIENT_SELECT)
      .order("name")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...((data ?? []) as unknown as ClientRow[]));
    if (!data || data.length < pageSize) break;
  }

  const csv = toCsv(
    ["Name", "Email", "Phone", "Status", "Owner", "Owner email", "Notes", "Created", "Updated"],
    all.map((c) => [
      c.name,
      c.email,
      c.phone,
      STATUS_LABEL[c.status],
      c.owner ? displayName(c.owner) : "",
      c.owner?.email ?? "",
      c.notes,
      format(new Date(c.created_at), "yyyy-MM-dd"),
      format(new Date(c.updated_at), "yyyy-MM-dd"),
    ]),
  );
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "clients";
  downloadBlob(
    new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }),
    `${slug}-clients-${format(new Date(), "yyyy-MM-dd")}.csv`,
  );
  return all.length;
}
