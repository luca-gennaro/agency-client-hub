# Security Review — Agency Client Hub

**Luca Gennaro**

**Application:** multi-tenant CRM for small agencies (companies, team members with admin/member roles, clients, uploaded documents, invite codes, CSV export). Generated with Lovable, backed by Supabase (Postgres, Auth, Storage).
**Review date:** 10 November 2026
**Deliverables:** this report · [`AUDIT_NOTES.md`](AUDIT_NOTES.md) (full technical notes, 18 findings) · [`security/EVIDENCE.md`](security/EVIDENCE.md) (request-by-request evidence) · [`drizzle/migrations/0002_security_hardening.sql`](drizzle/migrations/0002_security_hardening.sql) (the fix) · [`security/`](security/) (reproducible test suite)

---

## 1. Executive summary

Agency Client Hub lets several agencies share one application while keeping each agency's clients, documents and billing notes private. The most important question for a product like this is simple: **can one customer ever see or change another customer's data?**

**Before the fixes:** I found no way for one agency to read another agency's data today. However, the main wall between agencies was not held up by a rule written for that purpose. It held because of a side effect in how the database checks rows. One routine change to the database, the kind a developer or an AI code generator could add in a single step, would have let any person who signs up take over another agency's workspace as an administrator. I demonstrated this on a local copy of the system. Inside each agency, team members could also forge who created a record, change their displayed email address, store web pages disguised as documents, and choose easily guessable invite codes. Anyone logged in could find out who the administrators of other agencies are.

**After the fixes:** the wall between agencies is now explicit and doubled. Users no longer have permission to change which agency they belong to, and a second safeguard rejects that change even for internal administrative tools. Every other issue confirmed in testing is closed. All of the application's normal features were re-tested and still work.

**Status:** the fixes are written as one database migration and verified on a local copy of the system (30 automated tests and 5 database-level checks, all passing). **They are not yet deployed to production.** Twelve lower-priority observations remain open (F4, F6, F9–F18); none of them allows access to another agency's data.

|                                                          | Before                                  | After (verified locally)                                            |
| -------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| Can one agency reach another agency's data?              | Not today, but one ordinary change away | No; blocked by an explicit permission rule and a separate safeguard |
| Can a team member tamper with records or their identity? | Yes                                     | No                                                                  |
| Can a team member upload web pages as documents?         | Yes                                     | No (one accepted exception, see §6)                                 |
| Can invite codes be guessed or reused forever?           | Yes (admin-chosen codes, no expiry)     | No (generated codes, 7-day expiry)                                  |
| Can a logged-in user learn other agencies' admins?       | Yes                                     | No                                                                  |

---

## 2. Scope and method

**In scope:** database schema, access rules (Row Level Security) and permissions in the migrations; storage bucket and its rules; database functions, including the sign-up and invite flow; where roles are enforced (database vs user interface); secrets in the repository and what reaches the browser; the CSV export.

**Out of scope:** hosting infrastructure, the Supabase and Lovable platforms themselves, denial of service, social engineering, and the user interface beyond the data it requests.

**Method:**

1. **Code review.** I reviewed the migrations, the application code in `src/` and the repository history, read-only.
2. **Checks on the live configuration.** I confirmed on the production database the facts that could not be known from the code: the storage bucket settings, the permissions on the `profiles` table and its exact set of access rules. Production checks were read-only queries run from my Lovable SQL editor; the coding assistant (Claude Code) had no access to production.
3. **Reproducible local tests.** I build a local Supabase stack from the project's own migrations. Automated tests act as real users, using only the public key and genuine login sessions; no administrative key is used in any attack step. I first reproduced each finding in its vulnerable state, then re-tested it after the fix. A separate set of database-level checks covers what the public API cannot reach. Everything runs with one command (§7).
4. **AI-assisted, manually verified.** I produced the review, the tests and the fix with an AI coding assistant (Claude Code) and checked the results myself. Every claim in this report is backed by a test result or a query on the live configuration. Where a first assumption turned out wrong, I say so (F1, and a bug in the first version of the F5 fix).

**Severity scale:** _High_: could expose or let someone change another customer's data. _Medium_: lets someone inside a customer misuse the system or break its integrity. _Low_: information leak or weakness with limited impact. _Informational_: no direct risk, but worth fixing.

---

## 3. Findings

| ID             | Finding                                             | Severity       | Status before                                               | Status after                                     |
| -------------- | --------------------------------------------------- | -------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| F1             | A user could move their account into another agency | **High**       | **Latent**: not exploitable today, blocked by a side effect | Fixed (verified locally)                         |
| F2             | Team members could change fields they should not    | Medium         | Confirmed                                                   | Fixed (verified locally)                         |
| F3             | Storage bucket not defined in the code              | Informational  | Verified on production: private, 20 MB limit                | Defined in the migration                         |
| F5             | Uploads accepted any file type in any folder        | Medium         | Confirmed                                                   | Fixed, one accepted trade-off (verified locally) |
| F7             | Invite codes could be chosen and never expired      | Low            | Confirmed                                                   | Fixed (verified locally)                         |
| F8             | Anyone logged in could check other users' roles     | Low            | Confirmed                                                   | Fixed (verified locally)                         |
| F4, F6, F9–F18 | Other observations (see §5)                         | Medium to Info | Open                                                        | Open                                             |

"Verified locally" means: the fix is in [`0002_security_hardening.sql`](drizzle/migrations/0002_security_hardening.sql) and passes the test suite on a local copy of the system. It is not yet applied to production.

---

## 4. Findings in detail

### F1 — A user could move their account into another agency

**Severity:** High · **Before:** Latent, not exploitable today · **After:** Fixed (verified locally)

**Description.** Every access rule in the database decides "which agency are you in?" by reading a single field: `profiles.company_id`. Users were allowed to edit their own profile, and the rule for that edit only checked "is this your profile?", not "are you keeping the same agency?". The table permissions, meant to limit edits to the user's name, did not restrict anything (see F2). Both facts were confirmed on the production database.

**Why it is not exploitable today.** When a database update has to read the row it changes, which every update sent through the public API does, Postgres also requires the updated row to stay visible to the user. The only visibility rule on `profiles` is "you can see profiles of your own agency". A profile moved to another agency is no longer visible, so the update is rejected. That protection is real, but **nobody wrote it to prevent this attack**; it is a side effect. I confirmed on production that `profiles` has exactly the two access rules described here and no other, so production behaves like the local tests.

**Why it still matters.** One common, harmless-looking addition, a rule such as "users can always see their own profile", removes the side effect. With that single extra rule on a local copy, a freshly registered user moved into another agency and read its client list and its private billing notes **as an administrator**: everyone who signs up becomes the admin of their own new agency, and roles are not tied to an agency (F6). Rules like that are routinely added by developers and AI code generators. A database function or trigger that updates profiles without the usual filter would have the same effect.

**Business impact if it became exploitable.** Full takeover of any customer workspace by anyone who can create an account: access to client lists, notes and billing details, deletion of data, issuing invitations. The only thing the attacker needs is the target agency's internal ID, which is not secret: it appears in every shared document link.

**Evidence.**

- Before: the API attempts and their exact rejection messages, plus the local demonstration with the extra rule: [EVIDENCE.md → F1](security/EVIDENCE.md#f1--a-user-can-move-their-own-profile-into-another-company).
- Tests: [`security/tests/findings.test.ts`](security/tests/findings.test.ts), block _F1 — a profile cannot change company_; database checks: [`security/scripts/sql-checks.sql`](security/scripts/sql-checks.sql).

**Fix.** Table-level write permissions are revoked and re-granted only on the columns the app needs; on `profiles` that is the name alone. In addition, a trigger rejects any change of agency on a profile, whoever performs it, including internal tools that bypass the usual rules.

**Verification.** Through the API the change is now refused with "permission denied". The local demonstration with the extra "see own profile" rule now **fails**, and so does an update by the database superuser (stopped by the trigger).

### F2 — Team members could change fields they should not

**Severity:** Medium · **Before:** Confirmed · **After:** Fixed (verified locally)

**Description.** The migrations tried to limit what users can edit to specific columns. On Supabase, new tables automatically receive full permissions for logged-in users, and the migrations never removed them, so the column limits had no effect. Only the access rules stood in the way, and those check _which rows_ a user may touch, not _which fields_.

**Business impact.** Records cannot be trusted. A team member could make any client look as if someone else had created it, even a user from another agency. A user could change the email address shown next to their name, which appears in the team list, as client owner and in the CSV export, and so impersonate a colleague or an executive. F2 is also what made F1 possible.

**Evidence.** Before: a member rewrote a client's `created_by`; a user changed their own `email`. After: both are refused, as is creating a client with a forged author. [EVIDENCE.md → F2](security/EVIDENCE.md#f2--columns-outside-the-column-grants-are-writable) · tests: block _F2 — only the columns the app writes are writable_.

**Fix.** Insert, update and delete are revoked at table level. Each table gets back exactly the columns the application writes (checked against every screen in `src/`). Anonymous visitors get no write permission at all.

**Verification.** The three tampering attempts return "permission denied". Every write the application performs still succeeds (§4, _Normal features_).

### F3 — Storage bucket not defined in the code

**Severity:** Informational · **Before:** Verified on production (private, 20 MB limit) · **After:** Defined in the migration

**Description.** The bucket that holds client documents was created by hand, outside version control. I confirmed on production that it is private, with a 20 MB size limit and no file-type filter.

**Business impact.** None today. A new environment or a reset could recreate the bucket with unsafe settings, for example public, without anyone noticing.

**Fix and verification.** The migration now creates the bucket with the production settings plus a file-type filter (F5). On production it only adds the filter and leaves the other settings unchanged. The document tests run against this definition.

### F5 — Uploads accepted any file type in any folder

**Severity:** Medium · **Before:** Confirmed · **After:** Fixed, with one accepted trade-off (verified locally)

**Description.** The upload button only offers documents and images, but that restriction lived in the browser. Through the API, a team member could store any file, including an HTML page containing a script, in any folder of their agency, even one that belongs to no client. Such files do not appear in the app but stay readable by the whole team.

**Business impact.** Hidden files inside the workspace, and a way to plant web pages that could be used in phishing or script attacks against colleagues. Storage use also escapes the app's own bookkeeping.

**Evidence.** Before: an HTML file with a script was uploaded under a non-client folder, listed and downloaded back. After: HTML is refused by type, and a valid PDF is refused when its folder is not a real client. [EVIDENCE.md → F5](security/EVIDENCE.md#f5--storage-upload-not-bound-to-a-client-no-type-filter) · tests: block _F5 — uploads must be a known type, under a real client_.

**Fix.** The bucket accepts only the types the app offers (PDF, Word, Excel, CSV, text, PNG, JPEG), plus generic binary files (see §6). The upload rule also requires the folder to be a client of the user's agency.

**Verification.** Both attacks are refused. Normal uploads, including a file the browser cannot identify, downloads and deletions still work. The first version of this fix had a scoping bug that blocked _every_ upload. The tests for normal features caught it before anything was committed, which is the reason those tests exist.

### F7 — Invite codes could be chosen and never expired

**Severity:** Low · **Before:** Confirmed · **After:** Fixed (verified locally)

**Description.** An admin could create an invite with any code, even a single letter. A public, no-login function then confirmed the code and revealed the agency's name. Unused codes stayed valid forever.

**Business impact.** A weak or old invite lets an outsider join an agency as a team member, with access to all its clients.

**Evidence.** Before: an invite with code `A` was accepted, and an anonymous lookup returned the agency name. After: the custom code is refused, the lookup returns nothing, normal invites get a random 10-character code valid for 7 days, and expired codes are refused both by the lookup and at sign-up. [EVIDENCE.md → F7](security/EVIDENCE.md#f7--admins-choose-the-invite-code-invites-never-expire) · tests: block _F7 — invite codes come from the database and expire_.

**Fix.** Codes are always generated by the database. Invites carry an expiry date (default 7 days), which both the lookup and the sign-up process check.

**Verification.** As above. Creating, using and deleting invites from the Team page still work.

### F8 — Anyone logged in could check other users' roles

**Severity:** Low · **Before:** Confirmed · **After:** Fixed (verified locally)

**Description.** A helper function that answers "is this user an admin?" accepted any user ID from any caller.

**Business impact.** A small information leak: a logged-in user could find out which people in other agencies are administrators, which is useful for targeting.

**Evidence.** Before: a user of agency A learned that a user of agency B is an admin. After: the answer is "no" for users of other agencies, and still correct for oneself and for teammates. [EVIDENCE.md → F8](security/EVIDENCE.md#f8--has_role-accepts-any-user-id) · tests: block _F8 — has_role answers only for self and teammates_.

**Fix and verification.** The function now answers only about the caller or members of the caller's agency. Every access rule that uses it behaves as before.

### Normal features after the fixes

Tightening permissions is only useful if the product still works. [`security/tests/happy-path.test.ts`](security/tests/happy-path.test.ts) repeats the exact requests the application makes. All of them pass after the fix: sign-up with and without an invite, company settings, creating and editing clients, uploading, downloading and deleting documents, the CSV export (using the app's own CSV encoder), and the rule that only admins delete clients.

---

## 5. Other observations (open)

Recorded in [`AUDIT_NOTES.md`](AUDIT_NOTES.md); not fixed by this migration. None allows access to another agency's data.

| ID  | Observation                                                                       | Severity                  |
| --- | --------------------------------------------------------------------------------- | ------------------------- |
| F4  | No way to remove a team member or change their role: people who leave keep access | Medium                    |
| F6  | Roles are not tied to an agency (made F1 an admin takeover)                       | Medium (defence in depth) |
| F9  | Document details (name, size, type) are taken from the browser as sent            | Low                       |
| F10 | Deleting a client through the API leaves its files in storage                     | Low                       |
| F11 | Storage delete rule relies on a deprecated column (works locally)                 | Low                       |
| F12 | Login redirect check may allow a redirect to another site                         | Low, to verify            |
| F13 | `.env` file is tracked in git (it contains only public values)                    | Low                       |
| F14 | CSV export includes free-text notes for every team member                         | Info                      |
| F15 | Role checks in the interface match the database                                   | Info                      |
| F16 | Database functions could use a stricter `search_path`                             | Info                      |
| F17 | The app itself had no tests for data isolation (now covered by `security/`)       | Info                      |
| F18 | Auth settings (email confirmation, password rules) not verifiable from the code   | To verify                 |

---

## 6. Known trade-offs

- **Generic binary uploads stay allowed.** Browsers label files they cannot identify as `application/octet-stream`, for example Word files on a computer without Office. Blocking that type would break real uploads, so it remains allowed. A file stored this way is served as a download and never displayed as a web page; the app's download links force this explicitly. To verify on production: how the storage service serves such files when the download option is missing.
- **Expired invites still look open in the Team page.** The interface was deliberately left unchanged and does not read the new expiry date. An expired code fails with the same message as a used one. Invites that are unused when the migration runs will expire 7 days later.
- **Permissions are fixed for today's tables only.** The revoke applies to tables that exist when the migration runs. Tables added later will again receive Supabase's default permissions and need their own column grants.
- **Local versions may differ from production.** Tests run on Postgres 17.6, PostgREST 14.8 and pg_graphql 1.5.11. Production facts that matter (bucket settings, permissions and access rules on `profiles`) were checked on the live database; component versions were not.
- **Deployment goes through Lovable.** The project's database is managed by Lovable, so the migration has to be applied through it and has not been applied yet. Until then, production is in the "before" state described above.

---

## 7. Reproduce it

Requirements: Docker, the Supabase CLI and Node.js. From the repository root:

```sh
npm run security:test
```

The command builds a local Supabase stack from `drizzle/migrations`, runs 30 API tests as real users and 5 database-level checks, and prints the result of each. To see the "before" state, move `0002_security_hardening.sql` out of `drizzle/migrations` and run the command again: the tests assert the fixed behaviour, so each confirmed issue shows up as a failing test. Details: [`security/README.md`](security/README.md).
