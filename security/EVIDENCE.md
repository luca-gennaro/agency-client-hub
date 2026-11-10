# Security evidence — agency-client-hub

Reproduction of the findings in `AUDIT_NOTES.md` on a local Supabase stack, and of their fixes.

- **Before** = `drizzle/migrations/0000` + `0001` (the schema in production today).
- **After** = `0000` + `0001` + `0002_security_hardening.sql` (local only, not deployed).

Run: `npm run security:test` from the repo root. The script resets the local database from all migrations in `drizzle/migrations`, runs the API suite (`tests/findings.test.ts`, `tests/happy-path.test.ts`) and then the SQL checks (`scripts/sql-checks.sql`).
Last run (After): 2026-11-10, **30/30 tests passing, 5/5 SQL checks OK**.

## Environment

| Component     | Version                               |
| ------------- | ------------------------------------- |
| Supabase CLI  | 2.90.0                                |
| Postgres      | 17.6 (`supabase/postgres:17.6.1.106`) |
| PostgREST     | v14.8                                 |
| GoTrue (auth) | v2.188.1                              |
| Storage API   | v1.48.28                              |
| pg_graphql    | 1.5.11                                |

Bucket `client-documents`: production has `public = false`, `file_size_limit = 20971520`, `allowed_mime_types = NULL`. **This configuration was verified on the production database, not assumed.** In Before, `supabase/seed.sql` creates the bucket with these values. In After, migration 0002 creates it (same values plus a type filter) and the seed does nothing.

Local versions may differ from production. Behaviour that depends on them is marked **to verify on production**.

## Status summary

| #   | Finding                                                | Severity      | Before                                                                                                                                                                 | After (0002, local)                                                                |
| --- | ------------------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| F1  | A user can move their own profile into another company | High          | **Latent** — blocked by a side effect of RLS row checks, not by an intentional rule; becomes exploitable with a common additional SELECT policy (demonstrated locally) | Fixed: no UPDATE privilege on `company_id`, plus a trigger that rejects any change |
| F2  | Columns outside the column grants are writable         | Medium        | Confirmed                                                                                                                                                              | Fixed: table-level writes revoked, only the app's columns granted                  |
| F3  | Bucket not defined in the migrations                   | Informational | Verified on production: private, 20 MB                                                                                                                                 | Bucket now defined in 0002                                                         |
| F5  | Storage upload not bound to a client, no type filter   | Medium        | Confirmed                                                                                                                                                              | Fixed, with one accepted residual (`application/octet-stream`)                     |
| F7  | Admins choose the invite code; no expiry               | Low           | Confirmed                                                                                                                                                              | Fixed: code only from the database, 7-day expiry                                   |
| F8  | `has_role` accepts any user id                         | Low           | Confirmed                                                                                                                                                              | Fixed: answers only for the caller and teammates                                   |

## Actors and setup (both runs)

All API requests use the local anon key plus sessions from `auth.signUp`. The service role key is never used.

1. **A** signs up with `company_name: "Company A"`, no invite. Becomes admin of company A.
2. **B** signs up with `company_name: "Company B"`, no invite. Becomes admin of company B.
3. As B: two clients, and `billing_notes` set on `company_settings`.
4. As B: an invite with `{ created_by: B }`. **C** signs up with its code and becomes a member of company B.

Observed in both runs: roles `A: [admin]`, `B: [admin]`, `C: [member]`; before any attack A reads `[]` from `clients`.

---

## F1 — A user can move their own profile into another company

**Severity:** High.

**Fix in 0002:**

- `revoke insert, update, delete on all tables in schema public from anon, authenticated` followed by `grant update (full_name) on profiles`;
- trigger `profiles_prevent_company_change`, which raises `profiles.company_id cannot be changed` on any UPDATE that changes `company_id`, whoever runs it.

### Before — Latent

On production, configuration level: the `"Update own profile"` policy checks only `id = auth.uid()` in USING and WITH CHECK, and `authenticated` has UPDATE on `profiles.company_id`. On the live database `profiles` has only `"Update own profile"` and `"View teammates"`, with no other SELECT policy, so production matches the local result: not exploitable today.

| Step (as A)       | Request                                                                         | Observed                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Filtered update   | `PATCH /rest/v1/profiles?id=eq.<A>` `{ "company_id": "<B>" }`                   | `403`, `42501`, `new row violates row-level security policy for table "profiles"`. A stays in company A. |
| Unfiltered update | `PATCH /rest/v1/profiles` `{ "company_id": "<B>" }`                             | `400`, `21000`, `UPDATE requires a WHERE clause` (pg-safeupdate)                                         |
| GraphQL           | `updateprofilesCollection(set: {company_id: "<B>"}, filter: {id: {eq: "<A>"}})` | `errors: ["new row violates row-level security policy for table \"profiles\""]`                          |

Why it is blocked: when an UPDATE reads the target row, Postgres requires the new row to pass the SELECT policies too. `"View teammates"` compares against `current_company_id()`, which still returns company A inside the statement, so the moved row fails.

SQL demonstration. It ran as the local `postgres` user switched to `role authenticated` with A's JWT claims, inside rolled-back transactions; these are not attack steps:

| Statement as A                                                                                                    | Before                                                          |
| ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `update profiles set company_id = <B>` (no WHERE)                                                                 | **succeeded**: A sees B's `company_settings`                    |
| With one extra policy `for select using (id = auth.uid())`, `update profiles set company_id = <B> where id = <A>` | **succeeded**: A reads B's clients and `billing_notes` as admin |

### After — Fixed

| Step                                                | Request                                                       | Expected secure result        | Observed                                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Filtered update (API)                               | `PATCH /rest/v1/profiles?id=eq.<A>` `{ "company_id": "<B>" }` | Refused for lack of privilege | `403`, `42501`, `permission denied for table profiles`                                                                                    |
| Unfiltered update (API)                             | `PATCH /rest/v1/profiles` `{ "company_id": "<B>" }`           | Refused                       | `400`, `21000`, `UPDATE requires a WHERE clause`                                                                                          |
| GraphQL                                             | same mutation as above                                        | Refused                       | `errors: ["Input for type profilesUpdateInput contains extra keys [\"company_id\"]"]`: the column is no longer in the GraphQL update type |
| Final state                                         | `GET profiles`, `clients`, `company_settings` as A            | A still in A, nothing of B    | `company_id` = A, clients `[]`, settings = A's own row with `billing_notes: ""`                                                           |
| SQL demo with the extra `"view own profile"` policy | filtered update as A                                          | Fails                         | `permission denied for table profiles [42501]`                                                                                            |
| SQL demo without WHERE                              | `update profiles set company_id = <B>` as A                   | Fails                         | `permission denied for table profiles [42501]`                                                                                            |
| SQL, trigger only                                   | same update as `postgres` (bypasses grants and RLS)           | Fails                         | `profiles.company_id cannot be changed [42501]`                                                                                           |

Tests: `findings.test.ts` → `F1 — a profile cannot change company` (4 tests). SQL checks: `scripts/sql-checks.sql`, first two blocks.

---

## F2 — Columns outside the column grants are writable

**Severity:** Medium.

**Fix in 0002:** the table-level revoke above, then grants for exactly the columns `src/` writes:

| Table              | INSERT                                                                   | UPDATE          | DELETE |
| ------------------ | ------------------------------------------------------------------------ | --------------- | ------ |
| `companies`        | —                                                                        | `name`          | —      |
| `company_settings` | —                                                                        | `billing_notes` | —      |
| `profiles`         | —                                                                        | `full_name`     | —      |
| `invites`          | `created_by`                                                             | —               | yes    |
| `clients`          | `name, email, phone, status, notes, owner_id`                            | same            | yes    |
| `client_documents` | `client_id, file_name, storage_path, size_bytes, mime_type, uploaded_by` | —               | yes    |

`anon` gets no write privilege. `updated_at` is set by the trigger and `company_id`, `code`, `created_by` (clients) by column defaults, which need no grant.

### Before — Confirmed

| Step                                                                         | Request                                                              | Observed                                      |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------- |
| As member C, set `created_by` of B's client to A (a user of another company) | `PATCH /rest/v1/clients?id=eq.<client 1>` `{ "created_by": "<A>" }`  | `count = 1`, `created_by` changed from B to A |
| As A, change own `profiles.email`                                            | `PATCH /rest/v1/profiles?id=eq.<A>` `{ "email": "ceo@victim.test" }` | `count = 1`, email changed                    |

### After — Fixed

| Step                                                 | Request                                                              | Expected secure result | Observed                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| Member C rewrites `clients.created_by`               | `PATCH /rest/v1/clients?id=eq.<client 1>` `{ "created_by": "<A>" }`  | Refused                | `42501`, `permission denied for table clients`; `created_by` still B |
| Member C inserts a client with a forged `created_by` | `POST /rest/v1/clients` `{ "name": "Forged", "created_by": "<B>" }`  | Refused                | `42501`, `permission denied for table clients`                       |
| A changes own `profiles.email`                       | `PATCH /rest/v1/profiles?id=eq.<A>` `{ "email": "ceo@victim.test" }` | Refused                | `42501`, `permission denied for table profiles`; email unchanged     |

Tests: `findings.test.ts` → `F2 — only the columns the app writes are writable` (3 tests). The happy-path tests confirm that every write the app makes still works (see below).

---

## F3 — Bucket `client-documents` not defined in the migrations

**Severity:** Informational.

- **Before:** the bucket existed only on production (verified there: private, 20 MB, no type filter).
- **After:** 0002 creates it with `insert … on conflict (id) do update set allowed_mime_types = …`. On production the insert finds the existing bucket and only adds the type filter, leaving `public` and `file_size_limit` as they are.

No test of its own: covered indirectly by F5 and by the document happy-path tests.

---

## F5 — Storage upload not bound to a client, no type filter

**Severity:** Medium.

**Fix in 0002:**

- `allowed_mime_types` on the bucket, matching the upload input's `accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg"`: `application/pdf`, `application/msword`, `…wordprocessingml.document`, `application/vnd.ms-excel`, `…spreadsheetml.sheet`, `text/csv`, `text/x-csv`, `application/csv`, `text/plain`, `image/png`, `image/jpeg`, plus `application/octet-stream` (decision of 2026-11-10, see the residual below);
- the storage INSERT policy now also requires the second path segment to be a client of the caller's company.

**Bug found while fixing:** the first version of the policy used a bare `name` inside the `exists (select … from public.clients c …)` subquery. Postgres resolved it to `clients.name` rather than `storage.objects.name`, so every upload was refused, including the app's own. The happy-path document tests caught it, and the policy now uses `objects.name`.

### Before — Confirmed

| Step                                                    | Request                                                                                            | Observed                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Member C uploads HTML under `<company B>/not-a-client/` | `POST /storage/v1/object/client-documents/<B>/not-a-client/poc.html`, `text/html`, `<script>` body | Accepted. Listed with `mimetype: text/html`, downloadable, no `client_documents` row. |

### After — Fixed (with an accepted residual)

| Step                                                                                        | Request                                                               | Expected secure result      | Observed                                                          |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| Member C uploads HTML under a **real** client folder                                        | `…/client-documents/<B>/<client 1>/poc.html`, `text/html`             | Refused by the type filter  | `mime type text/html is not supported`                            |
| Member C uploads an allowed type (PDF) under a folder that is not a client                  | `…/client-documents/<B>/not-a-client/contract.pdf`, `application/pdf` | Refused by the path policy  | `new row violates row-level security policy`; folder listing `[]` |
| Accepted residual: HTML bytes sent as `application/octet-stream` under a real client folder | `…/<B>/<client 1>/renamed.bin`, `application/octet-stream`            | Stored only as octet-stream | Accepted, stored `mimetype: application/octet-stream`             |

The residual is deliberate. Browsers send `application/octet-stream` for files whose type they don't know (e.g. `.docx` on Windows without Office), and blocking it would break those uploads. A file stored as octet-stream is not rendered as a page. Signed URLs from the app add `download=<name>`, which the happy path confirmed is served as `attachment`. **To verify on production:** how the storage CDN serves octet-stream objects without the `download` parameter.

Tests: `findings.test.ts` → `F5 — uploads must be a known type, under a real client` (3 tests).

---

## F7 — Admins choose the invite code; invites never expire

**Severity:** Low.

**Fix in 0002:**

- no INSERT grant on `invites.code`: the code always comes from the column default;
- new column `expires_at timestamptz not null default now() + 7 days`, checked by both `lookup_invite` and `handle_new_user`. Existing unused invites on production will get `expires_at` = migration time + 7 days.

### Before — Confirmed

| Step                                    | Request                                                        | Observed      |
| --------------------------------------- | -------------------------------------------------------------- | ------------- |
| Admin B inserts an invite with code `A` | `POST /rest/v1/invites` `{ "created_by": "<B>", "code": "A" }` | Inserted      |
| Anonymous lookup                        | `POST /rest/v1/rpc/lookup_invite` `{ "_code": "a" }`           | `"Company B"` |

### After — Fixed

| Step                                                                                         | Request                                           | Expected secure result    | Observed                                                 |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| Admin B inserts an invite with code `A`                                                      | as above                                          | Refused                   | `42501`, `permission denied for table invites`           |
| Anonymous lookup of `a`                                                                      | as above                                          | Nothing                   | `null`                                                   |
| Invite created like the Team page                                                            | `POST /rest/v1/invites` `{ "created_by": "<B>" }` | Random code, 7-day expiry | `code: "9D1963BDCD"`, `expires_at - created_at = 7 days` |
| SQL: expired invite (inserted as `postgres` with `expires_at` = yesterday), lookup as `anon` | `select lookup_invite(<code>)`                    | `null`                    | `null`                                                   |
| SQL: sign-up with the expired code (insert into `auth.users`, which fires the trigger)       | —                                                 | Refused                   | `Invalid, expired or already used invite code`           |

Tests: `findings.test.ts` → `F7 — invite codes come from the database and expire` (3 tests). SQL checks: `scripts/sql-checks.sql`, last block.

UI note: `src/` does not read `expires_at`, so an expired invite still appears as open on the Team page. Using it gives the same error as an already-used code.

---

## F8 — `has_role` accepts any user id

**Severity:** Low.

**Fix in 0002:** `has_role` returns true only if the role exists **and** `_user_id` is the caller or a user of the caller's company. Every policy calls it with `auth.uid()`, so the policies behave as before.

### Before — Confirmed

| Step                             | Request                                                                | Observed |
| -------------------------------- | ---------------------------------------------------------------------- | -------- |
| A asks about B (another company) | `POST /rest/v1/rpc/has_role` `{ "_user_id": "<B>", "_role": "admin" }` | `true`   |

### After — Fixed

| Step                             | Request                                   | Expected secure result | Observed |
| -------------------------------- | ----------------------------------------- | ---------------------- | -------- |
| A asks about B (another company) | as above                                  | `false`                | `false`  |
| A asks about A                   | `{ "_user_id": "<A>", "_role": "admin" }` | `true`                 | `true`   |
| Member C asks about B (teammate) | `{ "_user_id": "<B>", "_role": "admin" }` | `true`                 | `true`   |

Tests: `findings.test.ts` → `F8 — has_role answers only for self and teammates` (3 tests).

---

## Normal flows after the fix (`tests/happy-path.test.ts`)

Each test repeats the request made by the code in `src/` (same tables, columns, select strings and storage paths).

| Flow                                                                                         | Source in `src/`                                    | Result                                                                                                                   |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Sign-up without invite → admin of a new company, empty settings                              | `routes/auth.tsx`                                   | OK                                                                                                                       |
| Admin creates an invite; `lookup_invite`; sign-up with the code → member, invite marked used | `routes/_authenticated/team.tsx`, `routes/auth.tsx` | OK                                                                                                                       |
| Admin saves company name and billing notes                                                   | `routes/_authenticated/settings.tsx`                | OK                                                                                                                       |
| User changes own `full_name`                                                                 | (grant kept, not used by the UI today)              | OK                                                                                                                       |
| Admin deletes an unused invite                                                               | `team.tsx`                                          | OK                                                                                                                       |
| Member creates and edits a client with the form payload, owner embed returned                | `components/client-form-dialog.tsx`, `lib/crm.ts`   | OK                                                                                                                       |
| Member uploads a PDF to `<company>/<client>/<uuid>-<name>` and inserts the document row      | `routes/_authenticated/clients_.$clientId.tsx`      | OK                                                                                                                       |
| Upload of a file with no browser type (sent as octet-stream)                                 | same                                                | OK                                                                                                                       |
| Admin downloads through `createSignedUrl(..., { download })`                                 | same                                                | OK, `200`, `content-disposition: attachment`, same bytes                                                                 |
| Uploader deletes the document row and the file                                               | same                                                | OK (row count 1, file removed). This also shows locally that the `owner` check in the storage delete policy works (F11). |
| CSV export: same select as `exportAllClients` + `toCsv` from `src/lib/csv.ts`                | `lib/crm.ts`, `lib/csv.ts`                          | OK, header + 1 row with the owner's name and email                                                                       |
| Client delete: member gets 0 rows, admin deletes                                             | `clients_.$clientId.tsx`                            | OK                                                                                                                       |

Not covered: anything in the browser itself (rendering, React Query caches). The tests exercise the same API calls, not the UI.

## Final output (After)

```
 ✓ tests/findings.test.ts > Setup > A and B are admins of two different companies, C is a member of B
 ✓ tests/findings.test.ts > F8 — has_role answers only for self and teammates > as A, has_role(B, 'admin') is false: no leak about another company
 ✓ tests/findings.test.ts > F8 — has_role answers only for self and teammates > as A, has_role(A, 'admin') is still true (used by every admin policy)
 ✓ tests/findings.test.ts > F8 — has_role answers only for self and teammates > as member C, has_role(B, 'admin') is true: teammates are still visible
 ✓ tests/findings.test.ts > F7 — invite codes come from the database and expire > as admin B, inserting an invite with code 'A' is refused
 ✓ tests/findings.test.ts > F7 — invite codes come from the database and expire > as anon, lookup_invite('a') returns nothing
 ✓ tests/findings.test.ts > F7 — invite codes come from the database and expire > an invite created like the Team page gets a random code and expires 7 days later
 ✓ tests/findings.test.ts > F2 — only the columns the app writes are writable > as member C, updating clients.created_by is refused
 ✓ tests/findings.test.ts > F2 — only the columns the app writes are writable > as member C, inserting a client with a forged created_by is refused
 ✓ tests/findings.test.ts > F2 — only the columns the app writes are writable > as A, updating own profiles.email is refused
 ✓ tests/findings.test.ts > F5 — uploads must be a known type, under a real client > as member C, an HTML file under a real client folder is refused (type filter)
 ✓ tests/findings.test.ts > F5 — uploads must be a known type, under a real client > as member C, an allowed type in a folder that is not a client is refused (path policy)
 ✓ tests/findings.test.ts > F5 — uploads must be a known type, under a real client > accepted residual: HTML bytes sent as application/octet-stream are stored, but only as octet-stream
 ✓ tests/findings.test.ts > F1 — a profile cannot change company > filtered PATCH of profiles.company_id is refused for lack of privilege
 ✓ tests/findings.test.ts > F1 — a profile cannot change company > unfiltered PATCH of profiles.company_id is refused
 ✓ tests/findings.test.ts > F1 — a profile cannot change company > GraphQL mutation of profiles.company_id is refused
 ✓ tests/findings.test.ts > F1 — a profile cannot change company > after all attempts A is still in company A and reads nothing of company B
 ✓ tests/happy-path.test.ts > (13 tests, listed above)
 Test Files  2 passed (2)
      Tests  30 passed (30)
==> SQL checks (rolled back, outside the API suite)
OK F1 demo (extra SELECT policy, filtered update): rejected — permission denied for table profiles [42501]
OK F1 demo (no WHERE): rejected — permission denied for table profiles [42501]
OK F1 trigger (as postgres): rejected — profiles.company_id cannot be changed [42501]
OK F7 expiry (lookup_invite as anon): null for an expired code
OK F7 expiry (sign-up trigger): rejected — Invalid, expired or already used invite code [P0001]
```

## Not covered

F4, F6, F9 (document metadata), F10, F12–F18 from `AUDIT_NOTES.md`.

## Before deploying 0002

- This project is connected to Lovable and `AGENTS.md` asks for schema changes to go through Lovable. The migration file is local and `drizzle/migrations/meta/_journal.json` was not updated.
- The revoke uses `on all tables in schema public`, so it only covers the tables that exist when it runs. Tables added later (e.g. by Lovable) will again receive Supabase's default privileges and need their own grants.
