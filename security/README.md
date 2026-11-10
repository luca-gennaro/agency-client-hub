# security/

Local, reproducible proof of the findings in `../AUDIT_NOTES.md` and of their fixes in
`../drizzle/migrations/0002_security_hardening.sql`. Nothing here is used by the app: `src/` and the root
`supabase/` folder are untouched.

## Run

From the repo root, with Docker running and the Supabase CLI installed:

```sh
npm run security:test
```

Extra arguments go to Vitest, e.g. `npm run security:test -- --reporter=verbose`.
Results are in the console and in `security/results/findings.json` and `happy-path.json` (gitignored).
To reproduce the "Before" state, move `0002_security_hardening.sql` out of `drizzle/migrations` temporarily.
Stop the stack with `supabase stop --workdir security`.

## What is in here

| Path                                                              | Purpose                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/run.sh`                                                  | One-command runner: copies `drizzle/migrations/*.sql` unchanged into `supabase/migrations/`, starts the stack if needed, runs `supabase db reset` (migrations + seed), reads only `API_URL` and `ANON_KEY` from `supabase status`, runs Vitest, then `scripts/sql-checks.sql`.                                     |
| `supabase/config.toml`                                            | Local stack config (`supabase init`). Project id `agency-client-hub-security`, ports 553xx so it does not clash with other local stacks on 543xx. Studio, Realtime, Inbucket, Edge Runtime and Analytics are off. Email confirmations off (CLI default), so sign-up returns a session. |
| `supabase/seed.sql`                                               | Creates the `client-documents` bucket with the production settings (`public = false`, `file_size_limit = 20971520`, `allowed_mime_types = NULL`) when no migration has created it. With 0002 present it does nothing.                                                                                             |
| `supabase/migrations/`                                            | Generated on every run from `drizzle/migrations`. Gitignored: the drizzle folder stays the single source.                                                                                                                                                                              |
| `tests/helpers.ts`                                                | Anon-key client, sign-up through the real auth flow (same metadata as `src/routes/auth.tsx`), observation recorder.                                                                                                                                                                    |
| `tests/findings.test.ts`                                          | Setup + F8, F7, F2, F5, F1, asserting the secure behaviour; one `describe` per finding.
| `tests/happy-path.test.ts` | The app's normal flows (sign-up with/without invite, settings, clients, documents, CSV export), same requests as `src/`.
| `scripts/sql-checks.sql` | Checks the API cannot reach (F1 with an extra SELECT policy, the F1 trigger, F7 expiry). Run as the local `postgres` user inside rolled-back transactions; prints `OK`/`UNEXPECTED`.                                                                                                                                                                                                                                                            |
| `vitest.config.ts`, `package.json`, `package-lock.json`, `.npmrc` | Test dependencies isolated from the app (`vitest`, `@supabase/supabase-js`). `.npmrc` sets `legacy-peer-deps` because npm 10.9 crashes resolving vitest 4 peer deps.                                                                                                                   |
| `EVIDENCE.md`                                                     | Before/After per finding: steps, requests, expected secure result, observed result.                                                                                                                                                                                                               |

## Rules the tests follow

- The service role key is never read, exported or used.
- Only the anon key and real user sessions in the API tests. The SQL checks use the local `postgres` user and always roll back.
- Assertions describe the **secure** state after 0002: a red test means a protection is gone. The "Before" results are recorded in `EVIDENCE.md`.
- Tests share one set of users and run in file order.

Requirements seen when this was built: Supabase CLI 2.90.0, Docker Desktop, Node 23.11 (vitest 4 prints an engine warning for Node 23; it runs fine).
