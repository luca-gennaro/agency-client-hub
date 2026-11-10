#!/usr/bin/env bash
# Rebuilds the local Supabase stack from drizzle/migrations and runs the security tests.
# Usage (from the repo root): npm run security:test
set -euo pipefail

SEC="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$SEC/.." && pwd)"
MIG="$SEC/supabase/migrations"

command -v supabase >/dev/null || { echo "Supabase CLI missing: brew install supabase/tap/supabase" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running: start Docker Desktop and retry" >&2; exit 1; }

# 1. Same schema as the app: copy the drizzle migrations unchanged (this folder is gitignored).
rm -rf "$MIG"
mkdir -p "$MIG"
cp "$ROOT"/drizzle/migrations/*.sql "$MIG"/

# 2. Test dependencies, isolated from the app's own.
if [ ! -d "$SEC/node_modules" ]; then
  (cd "$SEC" && npm ci --no-audit --no-fund)
fi

# 3. Start the stack if needed, then reset: migrations + seed.sql (the client-documents bucket).
if ! supabase status --workdir "$SEC" >/dev/null 2>&1; then
  echo "==> Starting local Supabase stack"
  supabase start --workdir "$SEC"
fi
echo "==> Resetting local database from drizzle/migrations"
supabase db reset --workdir "$SEC" --local

# 4. Only the API URL and the anon key reach the tests. The service role key is never exported.
STATUS="$(supabase status --workdir "$SEC" -o env)"
SUPABASE_URL="$(printf '%s\n' "$STATUS" | sed -n 's/^API_URL="\(.*\)"$/\1/p')"
SUPABASE_ANON_KEY="$(printf '%s\n' "$STATUS" | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')"
unset STATUS
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_ANON_KEY" ]; then
  echo "Could not read API_URL / ANON_KEY from supabase status" >&2
  exit 1
fi
export SUPABASE_URL SUPABASE_ANON_KEY

echo "==> Running security tests against $SUPABASE_URL"
cd "$SEC"
npx vitest run "$@"

# 5. SQL-level checks (local postgres user, rolled back). They reuse the users created by the tests.
echo "==> SQL checks (rolled back, outside the API suite)"
DB_CONTAINER="supabase_db_$(sed -n 's/^project_id = "\(.*\)"$/\1/p' "$SEC/supabase/config.toml")"
SQL_OUT="$(docker exec -i "$DB_CONTAINER" psql -U postgres -q -v ON_ERROR_STOP=1 < "$SEC/scripts/sql-checks.sql" 2>&1)"
printf '%s\n' "$SQL_OUT" | sed -n 's/^NOTICE:  //p'
if printf '%s\n' "$SQL_OUT" | grep -q -E 'UNEXPECTED|ERROR'; then
  echo "SQL checks failed" >&2
  exit 1
fi
