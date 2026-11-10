/**
 * Findings from AUDIT_NOTES.md, asserting the SECURE behaviour after
 * drizzle/migrations/0002_security_hardening.sql. A failing test means the protection is gone.
 *
 * Mapping (finding → describe block):
 *   F8 → "F8 — has_role answers only for self and teammates"
 *   F7 → "F7 — invite codes come from the database and expire"
 *   F2 → "F2 — only the columns the app writes are writable"
 *   F5 → "F5 — uploads must be a known type, under a real client"
 *   F1 → "F1 — a profile cannot change company"
 * Checks the API cannot reach (F1 with the extra SELECT policy, the F1 trigger, F7 expiry) are in
 * scripts/sql-checks.sql, run by scripts/run.sh after this suite.
 *
 * Only the anon key and real user sessions are used. Tests run in file order and share users.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  anonClient,
  companyIdOf,
  record,
  roleOf,
  signUp,
  writeObservations,
  type TestUser,
} from "./helpers";

const BILLING_NOTE =
  "Company B private billing: IBAN IT00X0000000000000000000000, retainer 4k/month";
const PERMISSION_DENIED = /permission denied for table/;

let userA: TestUser; // admin of company A (the attacker)
let userB: TestUser; // admin of company B (the victim)
let userC: TestUser; // member of company B, joined with an invite from B
let companyA: string;
let companyB: string;
let clientIds: string[] = [];

beforeAll(async () => {
  userA = await signUp("user-a", { full_name: "User A", company_name: "Company A" });
  userB = await signUp("user-b", { full_name: "User B", company_name: "Company B" });
  companyA = await companyIdOf(userA);
  companyB = await companyIdOf(userB);

  const { data: clients, error: clientsError } = await userB.client
    .from("clients")
    .insert([
      { name: "Victim Client One", email: "one@victim.test", notes: "Confidential deal notes" },
      { name: "Victim Client Two", email: "two@victim.test", notes: "Contract renewal in March" },
    ])
    .select("id");
  if (clientsError) throw clientsError;
  clientIds = (clients ?? []).map((c) => c.id as string);

  const { error: settingsError } = await userB.client
    .from("company_settings")
    .update({ billing_notes: BILLING_NOTE })
    .eq("company_id", companyB);
  if (settingsError) throw settingsError;

  const { data: invite, error: inviteError } = await userB.client
    .from("invites")
    .insert({ created_by: userB.id })
    .select("code")
    .single();
  if (inviteError) throw inviteError;
  userC = await signUp("user-c", { full_name: "User C", invite_code: invite.code as string });
});

afterAll(() => {
  writeObservations("findings");
});

describe("Setup", () => {
  it("A and B are admins of two different companies, C is a member of B", async () => {
    const companyC = await companyIdOf(userC);
    const roles = { A: await roleOf(userA), B: await roleOf(userB), C: await roleOf(userC) };
    record("setup", { companyA, companyB, companyC, roles, clientsCreatedByB: clientIds.length });

    expect(companyA).not.toBe(companyB);
    expect(companyC).toBe(companyB);
    expect(roles).toEqual({ A: ["admin"], B: ["admin"], C: ["member"] });
    expect(clientIds).toHaveLength(2);
    const { data: aClients } = await userA.client.from("clients").select("id");
    expect(aClients).toEqual([]);
  });
});

describe("F8 — has_role answers only for self and teammates", () => {
  it("as A, has_role(B, 'admin') is false: no leak about another company", async () => {
    const { data, error } = await userA.client.rpc("has_role", {
      _user_id: userB.id,
      _role: "admin",
    });
    record("F8-other-company", {
      request: "rpc has_role { _user_id: B, _role: 'admin' } as A",
      data,
      error,
    });

    expect(error).toBeNull();
    expect(data).toBe(false);
  });

  it("as A, has_role(A, 'admin') is still true (used by every admin policy)", async () => {
    const { data, error } = await userA.client.rpc("has_role", {
      _user_id: userA.id,
      _role: "admin",
    });
    record("F8-self", { data, error });

    expect(error).toBeNull();
    expect(data).toBe(true);
  });

  it("as member C, has_role(B, 'admin') is true: teammates are still visible", async () => {
    const { data, error } = await userC.client.rpc("has_role", {
      _user_id: userB.id,
      _role: "admin",
    });
    record("F8-teammate", { data, error });

    expect(error).toBeNull();
    expect(data).toBe(true);
  });
});

describe("F7 — invite codes come from the database and expire", () => {
  it("as admin B, inserting an invite with code 'A' is refused", async () => {
    const { data, error } = await userB.client
      .from("invites")
      .insert({ created_by: userB.id, code: "A" })
      .select("id, code")
      .single();
    record("F7-chosen-code", {
      request: "insert invites { created_by: B, code: 'A' } as B",
      data,
      error,
    });

    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(PERMISSION_DENIED);
  });

  it("as anon, lookup_invite('a') returns nothing", async () => {
    const { data, error } = await anonClient().rpc("lookup_invite", { _code: "a" });
    record("F7-anon-lookup", { request: "rpc lookup_invite { _code: 'a' } as anon", data, error });

    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("an invite created like the Team page gets a random code and expires 7 days later", async () => {
    const { data, error } = await userB.client
      .from("invites")
      .insert({ created_by: userB.id })
      .select("code, created_at, expires_at")
      .single();
    const days = data
      ? (Date.parse(data.expires_at as string) - Date.parse(data.created_at as string)) / 86_400_000
      : null;
    record("F7-default-invite", { data, error, days });

    expect(error).toBeNull();
    expect(data?.code).toMatch(/^[0-9A-F]{10}$/);
    expect(days).toBeCloseTo(7, 3);
  });
});

describe("F2 — only the columns the app writes are writable", () => {
  it("as member C, updating clients.created_by is refused", async () => {
    const target = clientIds[0]!;
    const { data, error } = await userC.client
      .from("clients")
      .update({ created_by: userA.id })
      .eq("id", target)
      .select("id, created_by");
    const after = await userC.client.from("clients").select("created_by").eq("id", target).single();
    record("F2-clients-created_by", {
      request: `update clients set created_by = A where id = ${target} as member C`,
      data,
      error,
      createdByAfter: after.data?.created_by,
    });

    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(PERMISSION_DENIED);
    expect(after.data?.created_by).toBe(userB.id);
  });

  it("as member C, inserting a client with a forged created_by is refused", async () => {
    const { data, error } = await userC.client
      .from("clients")
      .insert({ name: "Forged", created_by: userB.id })
      .select("id");
    record("F2-clients-insert-created_by", { data, error });

    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(PERMISSION_DENIED);
  });

  it("as A, updating own profiles.email is refused", async () => {
    const { error, count } = await userA.client
      .from("profiles")
      .update({ email: "ceo@victim.test" }, { count: "exact" })
      .eq("id", userA.id);
    const { data } = await userA.client
      .from("profiles")
      .select("email")
      .eq("id", userA.id)
      .single();
    record("F2-profiles-email", { count, error, emailAfter: data?.email });

    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(PERMISSION_DENIED);
    expect(data?.email).toBe(userA.email);
  });
});

describe("F5 — uploads must be a known type, under a real client", () => {
  const html = "<!doctype html><script>alert(document.domain)</script>";

  it("as member C, an HTML file under a real client folder is refused (type filter)", async () => {
    const objectPath = `${companyB}/${clientIds[0]}/poc.html`;
    const { data, error } = await userC.client.storage
      .from("client-documents")
      .upload(objectPath, new Blob([html], { type: "text/html" }));
    record("F5-html-type", {
      request: `storage upload client-documents/${objectPath} (text/html) as member C`,
      data,
      error: error?.message ?? null,
    });

    expect(data).toBeNull();
    expect(error?.message).toMatch(/mime type text\/html is not supported/i);
  });

  it("as member C, an allowed type in a folder that is not a client is refused (path policy)", async () => {
    const objectPath = `${companyB}/not-a-client/contract.pdf`;
    const { data, error } = await userC.client.storage
      .from("client-documents")
      .upload(objectPath, new Blob(["%PDF-1.4"], { type: "application/pdf" }));
    const listing = await userC.client.storage
      .from("client-documents")
      .list(`${companyB}/not-a-client`);
    record("F5-path", {
      request: `storage upload client-documents/${objectPath} (application/pdf) as member C`,
      data,
      error: error?.message ?? null,
      listing: listing.data?.map((o) => o.name),
    });

    expect(data).toBeNull();
    expect(error?.message).toMatch(/row-level security/i);
    expect(listing.data).toEqual([]);
  });

  it("accepted residual: HTML bytes sent as application/octet-stream are stored, but only as octet-stream", async () => {
    // Decision 2026-11-10: octet-stream stays allowed so files with an unknown browser type still upload.
    const folder = `${companyB}/${clientIds[0]}`;
    const { error } = await userC.client.storage
      .from("client-documents")
      .upload(`${folder}/renamed.bin`, new Blob([html], { type: "application/octet-stream" }));
    const listing = await userC.client.storage.from("client-documents").list(folder);
    const stored = listing.data?.find((o) => o.name === "renamed.bin");
    record("F5-octet-stream-residual", {
      error: error?.message ?? null,
      mimetype: stored?.metadata?.mimetype,
    });

    expect(error).toBeNull();
    expect(stored?.metadata?.mimetype).toBe("application/octet-stream");
  });
});

describe("F1 — a profile cannot change company", () => {
  it("filtered PATCH of profiles.company_id is refused for lack of privilege", async () => {
    const update = await userA.client
      .from("profiles")
      .update({ company_id: companyB }, { count: "exact" })
      .eq("id", userA.id);
    record("F1-filtered-patch", {
      request: "PATCH /rest/v1/profiles?id=eq.<A> { company_id: <company B> } as A",
      update: { status: update.status, count: update.count, error: update.error },
    });

    expect(update.error?.code).toBe("42501");
    expect(update.error?.message).toMatch(PERMISSION_DENIED);
  });

  it("unfiltered PATCH of profiles.company_id is refused", async () => {
    const update = await userA.client.from("profiles").update({ company_id: companyB });
    record("F1-unfiltered-patch", {
      request: "PATCH /rest/v1/profiles { company_id: <company B> } as A (no filter)",
      update: { status: update.status, error: update.error },
    });

    expect(update.error).not.toBeNull();
  });

  it("GraphQL mutation of profiles.company_id is refused", async () => {
    const { data: session } = await userA.client.auth.getSession();
    const query = `mutation { updateprofilesCollection(set: {company_id: "${companyB}"}, filter: {id: {eq: "${userA.id}"}}) { affectedCount } }`;
    const res = await fetch(`${SUPABASE_URL}/graphql/v1`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.session?.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    const body = (await res.json()) as { data: unknown; errors?: { message: string }[] };
    record("F1-graphql", { request: `POST /graphql/v1 ${query} as A`, status: res.status, body });

    expect(body.data ?? null).toBeNull();
    expect(body.errors?.length).toBeGreaterThan(0);
  });

  it("after all attempts A is still in company A and reads nothing of company B", async () => {
    const companyAfter = await companyIdOf(userA);
    const clients = await userA.client.from("clients").select("id");
    const settings = await userA.client
      .from("company_settings")
      .select("company_id, billing_notes")
      .maybeSingle();
    record("F1-final-state", { companyAfter, clients: clients.data, settings: settings.data });

    expect(companyAfter).toBe(companyA);
    expect(clients.data).toEqual([]);
    expect(settings.data).toEqual({ company_id: companyA, billing_notes: "" });
  });
});
