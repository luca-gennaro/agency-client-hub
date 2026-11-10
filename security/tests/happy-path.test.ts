/**
 * The app's normal flows still work after 0002_security_hardening.sql. Each request mirrors the
 * code in src/ (same tables, columns and paths), using only the anon key and real user sessions.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toCsv } from "../../src/lib/csv";
import { companyIdOf, record, roleOf, signUp, writeObservations, type TestUser } from "./helpers";

// Same strings as src/lib/crm.ts (CLIENT_SELECT, documentsQuery).
const CLIENT_SELECT =
  "id, name, email, phone, status, notes, owner_id, created_at, updated_at, owner:profiles!clients_owner_id_fkey(id, full_name, email)";
const DOCUMENT_SELECT =
  "id, file_name, storage_path, size_bytes, mime_type, uploaded_by, created_at, uploader:profiles!client_documents_uploaded_by_fkey(full_name, email)";

let admin: TestUser;
let member: TestUser;
let companyId: string;
let clientId: string;
let documentPath: string;

beforeAll(async () => {
  admin = await signUp("happy-admin", { full_name: "Happy Admin", company_name: "Happy Agency" });
  companyId = await companyIdOf(admin);
});

afterAll(() => {
  writeObservations("happy-path");
});

describe("Sign-up", () => {
  it("without invite: new company, admin role, empty company settings", async () => {
    const roles = await roleOf(admin);
    const settings = await admin.client
      .from("company_settings")
      .select("billing_notes")
      .maybeSingle();
    record("signup-without-invite", { roles, settings: settings.data, error: settings.error });

    expect(roles).toEqual(["admin"]);
    expect(settings.data).toEqual({ billing_notes: "" });
  });

  it("with invite: the Team page creates a code, the new user joins as member", async () => {
    // src/routes/_authenticated/team.tsx
    const { error: insertError } = await admin.client
      .from("invites")
      .insert({ created_by: admin.id });
    const { data: invites } = await admin.client
      .from("invites")
      .select("id, code, created_at, used_at, user:profiles!invites_used_by_fkey(full_name, email)")
      .order("created_at", { ascending: false });
    const code = invites?.[0]?.code as string;

    // src/routes/auth.tsx: lookup first, then sign up with the code in the metadata.
    const lookup = await admin.client.rpc("lookup_invite", { _code: code.toLowerCase() });
    member = await signUp("happy-member", { full_name: "Happy Member", invite_code: code });

    const used = await admin.client.from("invites").select("used_at").eq("code", code).single();
    record("signup-with-invite", {
      insertError,
      code,
      lookup: lookup.data,
      memberCompanyMatches: (await companyIdOf(member)) === companyId,
      memberRoles: await roleOf(member),
      usedAt: used.data?.used_at,
    });

    expect(insertError).toBeNull();
    expect(lookup.data).toBe("Happy Agency");
    expect(await companyIdOf(member)).toBe(companyId);
    expect(await roleOf(member)).toEqual(["member"]);
    expect(used.data?.used_at).not.toBeNull();
  });
});

describe("Company settings and team", () => {
  it("admin saves company name and billing notes (settings page)", async () => {
    // src/routes/_authenticated/settings.tsx
    const [a, b] = await Promise.all([
      admin.client.from("companies").update({ name: "Happy Agency Ltd" }).eq("id", companyId),
      admin.client
        .from("company_settings")
        .update({ billing_notes: "Net 30" })
        .eq("company_id", companyId),
    ]);
    const company = await admin.client
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .single();
    const settings = await admin.client
      .from("company_settings")
      .select("billing_notes, updated_at")
      .single();
    record("settings-save", {
      errors: [a.error, b.error],
      company: company.data,
      settings: settings.data,
    });

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(company.data?.name).toBe("Happy Agency Ltd");
    expect(settings.data?.billing_notes).toBe("Net 30");
  });

  it("a user can still change their own full_name", async () => {
    const { error } = await member.client
      .from("profiles")
      .update({ full_name: "Happy M." })
      .eq("id", member.id);
    const { data } = await member.client
      .from("profiles")
      .select("full_name")
      .eq("id", member.id)
      .single();

    expect(error).toBeNull();
    expect(data?.full_name).toBe("Happy M.");
  });

  it("admin deletes an unused invite", async () => {
    const { data: created } = await admin.client
      .from("invites")
      .insert({ created_by: admin.id })
      .select("id")
      .single();
    const { error, count } = await admin.client
      .from("invites")
      .delete({ count: "exact" })
      .eq("id", created?.id as string);

    expect(error).toBeNull();
    expect(count).toBe(1);
  });
});

describe("Clients", () => {
  it("member creates a client with the form payload", async () => {
    // src/components/client-form-dialog.tsx
    const payload = {
      name: "Acme S.r.l.",
      email: "info@acme.test",
      phone: "+39 02 1234567",
      status: "lead",
      notes: "First call on Monday",
      owner_id: member.id,
    };
    const { data, error } = await member.client
      .from("clients")
      .insert(payload)
      .select("id")
      .single();
    record("client-create", { data, error });

    expect(error).toBeNull();
    clientId = data?.id as string;
    expect(clientId).toBeTruthy();
  });

  it("member edits the client with the form payload", async () => {
    const payload = {
      name: "Acme S.r.l.",
      email: "hello@acme.test",
      phone: "+39 02 1234567",
      status: "active",
      notes: "Signed",
      owner_id: admin.id,
    };
    const { error } = await member.client.from("clients").update(payload).eq("id", clientId);
    const { data } = await member.client
      .from("clients")
      .select(CLIENT_SELECT)
      .eq("id", clientId)
      .maybeSingle();
    record("client-edit", { error, data });

    expect(error).toBeNull();
    expect(data).toMatchObject({ email: "hello@acme.test", status: "active", owner_id: admin.id });
    expect(data?.owner).toMatchObject({ id: admin.id, full_name: "Happy Admin" });
  });
});

describe("Documents", () => {
  const pdf = "%PDF-1.4\n% happy path\n";

  it("member uploads a PDF and the document row, as the client page does", async () => {
    // src/routes/_authenticated/clients_.$clientId.tsx
    const file = new File([pdf], "Contract 2026.pdf", { type: "application/pdf" });
    const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
    documentPath = `${companyId}/${clientId}/${crypto.randomUUID()}-${safeName}`;
    const upload = await member.client.storage
      .from("client-documents")
      .upload(documentPath, file, { contentType: file.type || undefined });
    const row = await member.client.from("client_documents").insert({
      client_id: clientId,
      file_name: file.name,
      storage_path: documentPath,
      size_bytes: file.size,
      mime_type: file.type,
      uploaded_by: member.id,
    });
    const docs = await member.client
      .from("client_documents")
      .select(DOCUMENT_SELECT)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    record("document-upload", {
      uploadError: upload.error?.message ?? null,
      rowError: row.error,
      docs: docs.data,
    });

    expect(upload.error).toBeNull();
    expect(row.error).toBeNull();
    expect(docs.data).toHaveLength(1);
    expect(docs.data?.[0]).toMatchObject({
      file_name: "Contract 2026.pdf",
      mime_type: "application/pdf",
    });
  });

  it("a file the browser has no type for (sent as octet-stream) still uploads", async () => {
    const file = new File(["PK\u0003\u0004"], "Offer.docx", { type: "" });
    const path = `${companyId}/${clientId}/${crypto.randomUUID()}-Offer.docx`;
    const { error } = await member.client.storage
      .from("client-documents")
      .upload(path, file, { contentType: file.type || undefined });
    record("document-upload-unknown-type", { error: error?.message ?? null });

    expect(error).toBeNull();
  });

  it("admin downloads it through a signed URL", async () => {
    const { data, error } = await admin.client.storage
      .from("client-documents")
      .createSignedUrl(documentPath, 60, { download: "Contract 2026.pdf" });
    const res = data ? await fetch(data.signedUrl) : null;
    const body = res ? await res.text() : null;
    record("document-download", {
      error: error?.message ?? null,
      status: res?.status,
      disposition: res?.headers.get("content-disposition"),
    });

    expect(error).toBeNull();
    expect(res?.status).toBe(200);
    expect(body).toBe(pdf);
  });

  it("the uploader deletes the document row and its file", async () => {
    const del = await member.client
      .from("client_documents")
      .delete({ count: "exact" })
      .eq("storage_path", documentPath);
    const remove = await member.client.storage.from("client-documents").remove([documentPath]);
    record("document-delete", { count: del.count, error: del.error, removed: remove.data?.length });

    expect(del.error).toBeNull();
    expect(del.count).toBe(1);
    expect(remove.error).toBeNull();
    expect(remove.data).toHaveLength(1);
  });
});

describe("CSV export", () => {
  it("member exports all clients with the same query and CSV encoder as the app", async () => {
    // src/lib/crm.ts exportAllClients
    const { data, error } = await member.client
      .from("clients")
      .select(CLIENT_SELECT)
      .order("name")
      .range(0, 999);
    const rows = (data ?? []) as unknown as {
      name: string;
      email: string;
      phone: string;
      status: string;
      notes: string;
      owner: { full_name: string; email: string } | null;
    }[];
    const csv = toCsv(
      ["Name", "Email", "Phone", "Status", "Owner", "Owner email", "Notes"],
      rows.map((c) => [
        c.name,
        c.email,
        c.phone,
        c.status,
        c.owner?.full_name ?? "",
        c.owner?.email ?? "",
        c.notes,
      ]),
    );
    record("csv-export", { error, rows: rows.length, csv });

    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain("Acme S.r.l.,hello@acme.test,+39 02 1234567,active,Happy Admin");
  });
});

describe("Client deletion", () => {
  it("member cannot delete a client, admin can", async () => {
    const asMember = await member.client
      .from("clients")
      .delete({ count: "exact" })
      .eq("id", clientId);
    const asAdmin = await admin.client
      .from("clients")
      .delete({ count: "exact" })
      .eq("id", clientId);
    record("client-delete", { member: asMember.count, admin: asAdmin.count, error: asAdmin.error });

    expect(asMember.count).toBe(0);
    expect(asAdmin.error).toBeNull();
    expect(asAdmin.count).toBe(1);
  });
});
