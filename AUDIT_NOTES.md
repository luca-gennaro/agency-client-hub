# Security audit — agency-client-hub (Clientbook)

Started 2026-11-10 as a read-only review of the code and migrations, then confirmed with a local reproduction (`security/`, see `security/EVIDENCE.md`) and with checks run on the production Lovable Cloud database.
Items marked **to verify** have not been confirmed against the live project yet; each one lists the query or test that would settle it.

Files reviewed: `drizzle/migrations/0000_crm_multi_tenant_schema.sql`, `drizzle/migrations/0001_restrict_helper_functions.sql`, `src/lib/*`, `src/routes/**`, `src/components/client-form-dialog.tsx`, `src/components/export-button.tsx`, `src/integrations/supabase/*`, `src/start.ts`, `src/server.ts`, `.env`, `.gitignore`, `vite.config.ts`, `src/test/*`.

---

## 1. Data model

| Table              | Tenant key        | Notes                                                                                                 |
| ------------------ | ----------------- | ----------------------------------------------------------------------------------------------------- |
| `companies`        | `id`              | The tenant. Created only by the sign-up trigger.                                                      |
| `company_settings` | `company_id` (PK) | `billing_notes`, admin only.                                                                          |
| `profiles`         | `company_id`      | 1 profile = 1 user = 1 company. **This is where the tenant comes from.**                              |
| `user_roles`       | — (none)          | `user_id` + `role` (`admin`/`member`). Global role, not tied to a company.                            |
| `invites`          | `company_id`      | Single-use code, no expiry.                                                                           |
| `clients`          | `company_id`      | Defaults to `current_company_id()`.                                                                   |
| `client_documents` | `company_id`      | Metadata; the file lives in bucket `client-documents` under `<company_id>/<client_id>/<uuid>-<name>`. |

**How a user's company is determined:** `public.current_company_id()` (SECURITY DEFINER, `0000:38-41`) = `select company_id from profiles where id = auth.uid()`. Every RLS and storage policy depends on it, so **`profiles.company_id` is the most sensitive value in the schema**: whoever can change it can pick their tenant.

**How the role is determined:** `public.has_role(user, role)` (`0000:43-46`) on `user_roles`, with no company filter.

**Entry point:** trigger `handle_new_user` on `auth.users` (`0000:231-268`). With an `invite_code` in the metadata the user becomes a member of the invite's company; without one, a new company is created and the user is its admin. Anyone can sign up and become admin of a new company.

**Server code:** there are no server functions (`createServerFn`), API routes or edge functions. All data access happens from the browser with the publishable key plus the user's JWT, so **RLS, grants and storage policies are the only real security boundary**. `supabaseAdmin` (`client.server.ts`) and `requireSupabaseAuth` exist but are not used.

---

## 2. Summary

| #   | Title                                                                                      | Severity                  | Status                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | A user can move their own profile into another company (as admin)                          | **High**                  | **Latent** — blocked by a side effect of RLS row checks, not by an intentional rule; becomes exploitable with a common additional SELECT policy (demonstrated locally) → Fixed by 0002, verified on production |
| F2  | Column-level grants restrict nothing: table-level privileges from Supabase defaults remain | Medium                    | Confirmed (local test + production config) → Fixed by 0002, verified on production |
| F3  | Bucket `client-documents` not defined in the migrations                                    | Informational             | Verified on production: private, 20 MB limit → defined in 0002, type filter verified on production |
| F4  | No way to remove a member or revoke a role                                                 | Medium                    | Code review                                                                                                                                                            |
| F5  | Upload: no server-side type filter, path not bound to a client                             | Medium                    | Confirmed (local test) → Fixed by 0002, verified on production |
| F6  | `user_roles` has no `company_id`: roles are global                                         | Medium (defence in depth) | Code review                                                                                                                                                            |
| F7  | Admins choose the invite code; invites never expire; anonymous `lookup_invite`             | Low                       | Confirmed (local test) → Fixed by 0002, verified on production |
| F8  | `has_role` accepts an arbitrary `_user_id`                                                 | Low                       | Confirmed (local test) → Fixed by 0002, verified on production |
| F9  | Attribution fields (`created_by`, document metadata) chosen by the client                  | Low                       | `created_by` confirmed (local test, see F2)                                                                                                                            |
| F10 | Orphaned storage files when a client is deleted through the API                            | Low                       | Code review                                                                                                                                                            |
| F11 | Storage delete policy relies on the `owner` column                                         | Low                       | to verify                                                                                                                                                              |
| F12 | `safeRedirect` does not block `/\`                                                         | Low                       | to verify                                                                                                                                                              |
| F13 | `.env` tracked and not in `.gitignore`                                                     | Low                       | Code review                                                                                                                                                            |
| F14 | CSV export: what it returns and to whom                                                    | Info                      | Code review                                                                                                                                                            |
| F15 | Roles: UI vs database                                                                      | Info                      | Code review                                                                                                                                                            |
| F16 | SECURITY DEFINER functions with `search_path = public`                                     | Info                      | Code review                                                                                                                                                            |
| F17 | No database-level isolation tests in the app                                               | Info                      | Partly addressed by `security/`                                                                                                                                        |
| F18 | Auth configuration (email confirmation, password policy)                                   | to verify                 | Not checkable from the repo                                                                                                                                            |

---

## 3. Findings

### F1 — A user can move their own profile into another company

- **Severity:** High
- **Status:** **Latent** — blocked by a side effect of RLS row checks, not by an intentional rule; becomes exploitable with a common additional SELECT policy (demonstrated locally). **Fixed by 0002, verified on production:** no table-level UPDATE for `authenticated`, `profiles` updatable only on `full_name`, trigger `profiles_prevent_company_change` present.
- **File:** `drizzle/migrations/0000_crm_multi_tenant_schema.sql:96` (grant), `:134-137` (policies)
- **Why it is a problem:** the `"Update own profile"` policy is `using (id = auth.uid()) with check (id = auth.uid())`, so its WITH CHECK places no constraint on `company_id`. The grant `update (full_name)` was meant to protect the other columns, but `authenticated` also holds table-level UPDATE (F2). Confirmed on production: `authenticated` has UPDATE on `profiles.company_id`, and the policy is exactly as above. If the update went through, `current_company_id()` would return the victim's company and the user would read and change its clients, documents and storage. Because roles are global (F6), and anyone who signs up without an invite is admin, the user would arrive **as admin**: billing notes, client deletion, invite creation. The victim company's UUID is not a secret: it appears in every storage path and therefore in every shared signed URL.
- **Why it is blocked today:** in Postgres, when an UPDATE reads the target row (any filter on the table's columns), the new row must also pass the table's SELECT policies. On `profiles` the only one is `"View teammates"` (`company_id = current_company_id()`). Inside the statement `current_company_id()` still returns the old company, so the moved row fails it. Without a filter, PostgREST refuses the UPDATE through pg-safeupdate. Production was checked: `profiles` has only these two policies (`"Update own profile"`, `"View teammates"`) and no other SELECT policy, so production behaves like the local stack.
- **What would make it exploitable:**
  - a common additional policy such as `for select using (id = auth.uid())` ("users can view their own profile"). Demonstrated locally: with that policy, A moves into company B and reads B's clients and billing notes as admin;
  - any SECURITY DEFINER function, trigger or code path that updates `profiles` without filtering on its columns (demonstrated locally in SQL: `update profiles set company_id = <B>` without WHERE succeeds);
  - a change in how PostgREST or pg_graphql build UPDATEs, or pg-safeupdate being disabled.
- **How to prove it with a test:** `security/tests/findings.test.ts`, block F1 (three tests: filtered PATCH, unfiltered PATCH, GraphQL), plus the rolled-back SQL demonstration recorded in `security/EVIDENCE.md`. The tests assert the current state and turn red when the grant is fixed or when the exploit starts working.
- **Fix (ask Lovable, not by hand — see AGENTS.md):** `revoke update on public.profiles from authenticated; grant update (full_name) on public.profiles to authenticated;` and make the policy explicit about the tenant, e.g. a WITH CHECK that `company_id = current_company_id()`, or a trigger that rejects changes to `company_id`.

### F2 — Column-level grants restrict nothing

- **Severity:** Medium
- **Status:** Confirmed — local test, and on production `authenticated` had UPDATE on `profiles.company_id` despite the column grant. **Fixed by 0002, verified on production:** no table-level UPDATE for `authenticated` on public tables; `profiles` updatable only on `full_name`.
- **File:** `drizzle/migrations/0000_crm_multi_tenant_schema.sql:91-105`
- **Why it is a problem:** Supabase's default privileges grant ALL on new tables in `public` to `anon`, `authenticated` and `service_role`. The migrations add column grants (`grant select, update (name)`, …) but never `revoke`, and a column grant does not remove an existing table grant. Locally, `information_schema.role_table_grants` shows every privilege (including UPDATE, INSERT, DELETE, TRUNCATE) on `profiles` for both `anon` and `authenticated`. RLS policies are therefore the only line of defence. Observed effects:
  - a member rewrites `clients.created_by`, even to a user of another company (the foreign key accepts any profile);
  - a user changes their own `profiles.email`, which teammates see in Team, in owner fields and in the CSV export;
  - it is the precondition for F1.
    Tables with no INSERT/UPDATE policy (`user_roles`, `companies` insert, `invites` update, `client_documents` update) stay protected by RLS. `anon` reads nothing because every policy is `to authenticated`.
- **How to prove it with a test:** `security/tests/findings.test.ts`, block F2 (`clients.created_by` as member C; `profiles.email` as A). Query: `select table_name, grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') order by 1,2,3;`.

### F3 — Bucket `client-documents` not defined in the migrations

- **Severity:** Informational
- **Status:** Verified on production: `public = false`, `file_size_limit = 20971520` (20 MB), `allowed_mime_types = NULL`. **Now defined in 0002**; on production the bucket is still private and has the new `allowed_mime_types`.
- **File:** `drizzle/migrations/0000_crm_multi_tenant_schema.sql:270-283` (policies only); `src/lib/crm.ts:138`
- **Why it matters:** the bucket is configured outside version control, so a new environment or a reset could create it with different settings (public, no limit) without anyone noticing. The production configuration is safe on visibility and size; the missing type filter is F5.
- **How to prove it with a test:** `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'client-documents';` on each environment. `security/supabase/seed.sql` reproduces the production values locally.

### F4 — No way to remove a member or change their role

- **Severity:** Medium
- **File:** `drizzle/migrations/0000_crm_multi_tenant_schema.sql:133-148` (no DELETE policy on `profiles`/`user_roles`); `src/routes/_authenticated/team.tsx`
- **Why it is a problem:** someone who leaves the agency keeps access to every client and document until someone removes them by hand from `auth.users` in the dashboard. There is also no way to demote an admin. This is an operational security gap (offboarding) as much as a missing feature.
- **How to prove it with a test:** as admin, `supabase.from('profiles').delete().eq('id', <member>)` and `from('user_roles').delete()…` → 0 rows; the Team page offers no remove action.

### F5 — Upload: no server-side type filter, path not bound to a client

- **Severity:** Medium
- **Status:** Confirmed (local test with the production bucket configuration). **Fixed by 0002, verified on production:** bucket has the new `allowed_mime_types`; the INSERT policy requires `foldername(objects.name)[2]` to be a client of the caller's company. Accepted residual: `application/octet-stream` stays allowed.
- **File:** `drizzle/migrations/0000_crm_multi_tenant_schema.sql:274-276`; `src/routes/_authenticated/clients_.$clientId.tsx:45,254,333`
- **Why it is a problem:** `accept=".pdf,..."` is client-side only and the bucket has `allowed_mime_types = NULL`. The INSERT policy only checks that the first folder is the user's company. A member uploaded `poc.html` (`text/html`, containing a script) into `<company>/not-a-client/` through the API, listed it and downloaded it back. No `client_documents` row points to it, so it is invisible in the app but readable by the whole company. The 20 MB limit is enforced by the bucket (F3). Whether a signed URL renders the file as HTML in the browser is **to verify**.
- **How to prove it with a test:** `security/tests/findings.test.ts`, block F5.

### F6 — `user_roles` has no `company_id`

- **Severity:** Medium (defence in depth)
- **File:** `drizzle/migrations/0000_crm_multi_tenant_schema.sql:30-35,43-46`
- **Why it is a problem:** `has_role(auth.uid(),'admin')` means "admin somewhere", not "admin of this company". It holds today only because a user has a single company and cannot change it. This is what would turn F1 into an admin takeover rather than member access, and any future change (multiple companies, moving users) inherits the problem.
- **How to prove it with a test:** covered by the local SQL demonstration of F1 (after the move, A reads `company_settings` of company B, which is admin-only).

### F7 — Admins choose the invite code; invites never expire

- **Severity:** Low
- **Status:** Confirmed (local test). **Fixed by 0002, verified on production:** `invites.expires_at` present; codes come only from the column default (no INSERT grant on `code`).
- **File:** `drizzle/migrations/0000_crm_multi_tenant_schema.sql:49-57,100,221-228`
- **Why it is a problem:** the INSERT grant on `invites` includes `code`, so an admin can create an invite with code `A`. `lookup_invite` is callable by `anon` and returned `"Company B"` for `'a'`: anyone guessing a trivial code learns the company name and can join it as a member. The default codes (10 hex characters, ~40 bits) are not practically guessable, but there is no specific rate limiting. Unused codes never expire, so a forwarded link stays valid forever.
- **How to prove it with a test:** `security/tests/findings.test.ts`, block F7. For expiry: create an invite, backdate `created_at` by 30 days, sign up with it → it still works.

### F8 — `has_role` accepts an arbitrary `_user_id`

- **Severity:** Low
- **Status:** Confirmed (local test). **Fixed by 0002, verified on production:** `pg_get_functiondef('public.has_role')` answers only for `auth.uid()` or users with `company_id = current_company_id()`.
- **File:** `drizzle/migrations/0001_restrict_helper_functions.sql:3-4`; `0000:43-46`
- **Why it is a problem:** it is SECURITY DEFINER and any `authenticated` user can call it through `/rest/v1/rpc/has_role`. User A (company A) asked about user B (company B) and got `true`. Small information leak about other tenants.
- **How to prove it with a test:** `security/tests/findings.test.ts`, block F8.

### F9 — Attribution chosen by the client

- **Severity:** Low
- **Status:** `clients.created_by` confirmed (local test under F2), and no longer writable after 0002; document metadata from code review, still open.
- **File:** `drizzle/migrations/0000_crm_multi_tenant_schema.sql:70,169-185` (`clients.created_by`), `:193-200` (`client_documents`)
- **Why it is a problem:** the INSERT policy on `clients` does not check `created_by = auth.uid()`, and UPDATE allows changing it (F2). On `client_documents`, `file_name`, `size_bytes` and `mime_type` are whatever the client sends, and `storage_path` is checked only on its first segment (not that the file exists or sits under the right `client_id`). Everything stays inside the tenant, but the audit trail and metadata are not reliable.
- **How to prove it with a test:** as a member, `insert clients {name:'x', created_by:<another member>}` → succeeds; `insert client_documents {client_id:C1, storage_path:'<company>/<C2>/someone-elses-file', size_bytes:1}` → succeeds.

### F10 — Orphaned files after deleting a client

- **Severity:** Low
- **File:** `drizzle/migrations/0000_crm_multi_tenant_schema.sql:81` (`on delete cascade`); `src/routes/_authenticated/clients_.$clientId.tsx:91-101`
- **Why it is a problem:** the browser removes the files before deleting the client. A delete through the API, or a failure halfway, removes the `client_documents` rows by cascade but leaves the files in the bucket, still readable by the company. Retention / right-to-erasure issue.
- **How to prove it with a test:** as admin, `supabase.from('clients').delete().eq('id', C)` directly → `storage.from('client-documents').list('<company>/<C>')` still returns the files.

### F11 — Storage delete relies on `owner`

- **Severity:** Low — **to verify**
- **File:** `drizzle/migrations/0000_crm_multi_tenant_schema.sql:277-283`
- **Why it is a problem:** `storage.objects.owner` is deprecated in favour of `owner_id` (text). If the storage version in use no longer fills `owner`, members cannot delete their own files: the row disappears but the file stays, because `clients_.$clientId.tsx:294` ignores the error from `remove`.
- **How to prove it with a test:** as a member, upload and delete a document; then `select name, owner, owner_id from storage.objects where bucket_id='client-documents'` → the file must be gone.

### F12 — `safeRedirect` does not block `/\`

- **Severity:** Low — **to verify**
- **File:** `src/routes/auth.tsx:18-21,33,88`
- **Why it is a problem:** it blocks `//evil.com` but not `/\evil.com`, which browsers normalise to `//evil.com`. If TanStack Router's `redirect({ href })` / `navigate({ href })` ends in a document navigation, this is an open redirect after login (phishing).
- **How to prove it with a test:** signed in, open `/auth?redirect=/%5Cexample.com` and check the final URL; unit test `safeRedirect('/\\example.com')` → expected `/dashboard`.

### F13 — `.env` tracked by git

- **Severity:** Low
- **File:** `.env` (tracked, commit `e3238c2`), `.gitignore` (ignores only `*.local`)
- **Why it is a problem:** today it holds only values that are public by design (URL, project id, `sb_publishable_...`), and the git history contains no `sb_secret_` or service role key. But the file is tracked and not ignored: the first secret added there ends up in the repo and in Lovable. Only the `VITE_*` variables reach the browser (URL, project id, publishable key), which is correct. `SUPABASE_SERVICE_ROLE_KEY` is read only in `client.server.ts`, which nothing imports. With the publishable key alone anyone can call the API and sign up; security rests entirely on RLS.
- **How to prove it with a test:** `git ls-files .env`; `git log --all -p | grep -E 'sb_secret_|service_role'` (empty today); production build and `grep -r "sb_secret\|service_role" dist/` → expected empty.

### F14 — CSV export

- **Severity:** Info
- **File:** `src/lib/crm.ts:151-186`, `src/lib/csv.ts:1-16`, `src/components/export-button.tsx`, `src/lib/permissions.ts:11`
- **What it returns and to whom:** a browser query on `clients` (RLS: the user's company only), paged by 1000, with name, email, phone, status, owner name and email, **free-text notes**, dates. Available to admins and members. There is no server endpoint: hiding the button from members would not stop them selecting the same data through the API. If export must be admin-only, the only way is to restrict reads (e.g. notes admin-only), which is a product decision. Without F1 there is no cross-tenant leak. Owner emails can be spoofed (F2).
  Formula injection: `= @ \t \r` and non-phone `+ -` are neutralised. Minor residue: `PHONE_LIKE` lets `-1-1` through (Excel evaluates it; harmless without letters/functions); values with leading spaces before `=` are not prefixed (**to verify** in Excel/LibreOffice/Sheets).
- **How to prove it with a test:** unit tests in `src/test/csv.test.ts` for `" =HYPERLINK(...)"`, `"-1-1"`, `"\u0000=1"`; integration test: an export as a member of X contains no rows of Y.

### F15 — Where roles are enforced

- **Severity:** Info
- **File:** `src/lib/permissions.ts:7-15`, `src/routes/_authenticated/settings.tsx:29-32`, `team.tsx:66`, `clients_.$clientId.tsx:144,357`
- **Result:** the UI rules match the database: client delete admin-only (`0000:186-188`), invites admin-only (`:151-164`), billing notes and company name admin-only (`:119-131`), document delete by uploader or admin (`:201-206`, `:277-283`). Route guards (`beforeLoad` in `settings.tsx`, `_authenticated/route.tsx`) are UX only and run with `ssr: false`; RLS is the real protection. The role in `current-user.ts:39` is read from the database, not from the JWT. The weak points are not in the UI but in the global role (F6) and the writable tenant (F1).
- **How to prove it with a test:** as a member, call through the API what the UI hides: `delete clients`, `insert invites`, `select company_settings`, `update companies` → all 0 rows / error.

### F16 — SECURITY DEFINER with `search_path = public`

- **Severity:** Info
- **File:** `drizzle/migrations/0000_crm_multi_tenant_schema.sql:39,44,222,232`
- **Why:** `search_path` is set (good), but Supabase recommends `set search_path = ''` with qualified names. Users cannot create objects in `public` (to confirm: `CREATE` on the schema), so it is not exploitable today. `handle_new_user` trusts `raw_user_meta_data` only to choose between "new company" and "valid invite", and the invite is checked with `for update`: correct. The `revoke` on `handle_new_user` is correct.
- **How to prove it with a test:** `select has_schema_privilege('authenticated','public','CREATE');` → expected `false`. Supabase Advisor "function_search_path_mutable".

### F17 — No database-level isolation tests in the app

- **Severity:** Info
- **File:** `src/test/permissions.test.ts`
- **Why:** the app's tests only check the UI map (`permissions.ts`), which by design protects nothing. The commit "Verified data isolation" has no reproducible test in the repo. `security/` now covers F1, F2, F5, F7 and F8 with real sessions; F4, F9 (documents), F10, F11 and F15 are not covered yet.
- **How to prove it with a test:** extend `security/tests` with the cases listed in each finding above.

### F18 — Auth configuration

- **Severity:** to verify
- **File:** `src/routes/auth.tsx:194-219`
- **Why:** the 8-character password minimum is checked only in the browser. If email confirmation is off, anyone can sign up with someone else's email, and that email shows up as their identity in Team and in the CSV. The invite is consumed at sign-up even if the email is never confirmed.
- **How to prove it with a test:** in Lovable Cloud / the Auth dashboard check "Confirm email", minimum password length and leaked password protection. Test: `supabase.auth.signUp({ email, password: '123' })` → expected rejection.

---

## 4. Status and next steps

Migration `drizzle/migrations/0002_security_hardening.sql` fixes F1, F2, F5, F7 and F8, defines the bucket (F3) and makes `clients.created_by` read-only (part of F9). It is applied to production through the Lovable SQL editor, in one transaction, and verified there with read-only queries (details in `security/EVIDENCE.md`, "Production verification"). Lovable's own migration history does not include it.

Still open:
1. F4 — a way for admins to remove members and change roles.
2. F6 — tie roles to a company (or keep the `company_id` trigger as the guarantee).
3. F9 (document metadata), F10, F11, F12, F13 — low-severity items.
4. F14–F18 — informational items and the Auth configuration check.
