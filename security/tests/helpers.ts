import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_ANON_KEY are required: run `npm run security:test` from the repo root.",
  );
}

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = anonKey;

/** A client with the anon key only: no session, like a visitor of the sign-up page. */
export function anonClient(): SupabaseClient {
  return createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type TestUser = {
  id: string;
  email: string;
  client: SupabaseClient;
};

/**
 * Sign up through the real auth flow (same metadata as src/routes/auth.tsx) and keep the session.
 * Local auth has email confirmations off, so sign-up returns a session straight away.
 */
export async function signUp(
  label: string,
  data: { full_name: string; company_name?: string; invite_code?: string },
): Promise<TestUser> {
  const client = anonClient();
  const email = `${label}-${Date.now()}@security.test`;
  const { data: res, error } = await client.auth.signUp({
    email,
    password: "correct-horse-battery-staple",
    options: { data },
  });
  if (error) throw new Error(`sign-up of ${label} failed: ${error.message}`);
  if (!res.session || !res.user) throw new Error(`sign-up of ${label} returned no session`);
  return { id: res.user.id, email, client };
}

export async function companyIdOf(user: TestUser): Promise<string> {
  const { data, error } = await user.client
    .from("profiles")
    .select("company_id")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  return data.company_id as string;
}

export async function roleOf(user: TestUser): Promise<string[]> {
  const { data, error } = await user.client
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id);
  if (error) throw error;
  return (data ?? []).map((r) => r.role as string);
}

/** Observations collected during the run, written to security/results/<name>.json. */
const observations: Record<string, unknown> = {};

export function record(finding: string, observation: unknown) {
  observations[finding] = observation;
  console.log(`[${finding}]`, JSON.stringify(observation, null, 2));
}

export function writeObservations(name: string) {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../results");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${name}.json`),
    JSON.stringify({ ranAt: new Date().toISOString(), supabaseUrl: url, observations }, null, 2),
  );
}
