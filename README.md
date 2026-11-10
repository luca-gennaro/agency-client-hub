# Agency Client Hub — a security case study

Agency Client Hub is a multi-tenant CRM for small agencies: each agency has its own team, clients, documents and invite codes, all in one Supabase database. It was generated with Lovable, and on the surface its data isolation looked right: every table had access rules, and the app hid admin features from members. I reviewed the schema, checked the live configuration and built a local test suite acting as real users, and the picture turned out more nuanced. The wall between agencies held only because of a side effect in how Postgres checks updated rows. One ordinary extra rule would have let anyone who signs up take over another agency as its admin, which I demonstrated on a local copy. Along the way I confirmed several smaller issues: forgeable records, arbitrary file uploads, guessable invite codes and a role lookup that leaked across agencies. I fixed all of them in one migration and re-tested it together with every normal feature of the app; everything is reproducible with a single command.

## Before and after

| Finding                                                  | Severity      | Before                                                  | After (verified locally)             |
| -------------------------------------------------------- | ------------- | ------------------------------------------------------- | ------------------------------------ |
| F1 — A user could move their account into another agency | High          | Latent: not exploitable today, blocked by a side effect | Fixed: explicit permission + trigger |
| F2 — Team members could change fields they should not    | Medium        | Confirmed                                               | Fixed                                |
| F3 — Storage bucket not defined in the code              | Informational | Private, 20 MB (verified on production)                 | Defined in the migration             |
| F5 — Uploads accepted any file type in any folder        | Medium        | Confirmed                                               | Fixed (one accepted trade-off)       |
| F7 — Invite codes could be chosen and never expired      | Low           | Confirmed                                               | Fixed                                |
| F8 — Anyone logged in could check other users' roles     | Low           | Confirmed                                               | Fixed                                |

30 API tests and 5 database-level checks pass after the fix. The migration has not been deployed to production yet. Twelve lower-priority observations remain open (F4, F6, F9–F18); see the report.

## Reproduce it

Requirements: Docker, the [Supabase CLI](https://supabase.com/docs/guides/cli) and Node.js. From the repository root:

```sh
npm run security:test
```

This builds a local Supabase stack from `drizzle/migrations`, runs the tests as real users with only the public key, then runs the database-level checks. More in [`security/README.md`](security/README.md).

## Read more

- [`REPORT.md`](REPORT.md): the security review, for founders first and developers second
- [`security/EVIDENCE.md`](security/EVIDENCE.md): every request, expected result and observed result, before and after
- [`drizzle/migrations/0002_security_hardening.sql`](drizzle/migrations/0002_security_hardening.sql): the fix
- [`AUDIT_NOTES.md`](AUDIT_NOTES.md): full technical notes on all 18 findings

## Running the app

```sh
npm i
npm run dev
```

Built with [Lovable](https://lovable.dev). I produced the review, tests and fix with an AI coding assistant (Claude Code). I checked production myself with read-only queries; the assistant had no access to production. — Luca Gennaro
