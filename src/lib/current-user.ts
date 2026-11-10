import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Role } from "@/lib/permissions";

export type CurrentUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  company: { id: string; name: string };
};

async function fetchCurrentUser(): Promise<CurrentUser> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("You are not signed in.");

  const [profileRes, rolesRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, email, company:companies(id, name)")
      .eq("id", user.id)
      .single(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);
  if (profileRes.error) throw profileRes.error;
  if (rolesRes.error) throw rolesRes.error;

  const profile = profileRes.data;
  const company = profile.company as { id: string; name: string } | null;
  if (!company) throw new Error("Your account is not linked to a company.");

  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: (rolesRes.data ?? []).some((r) => r.role === "admin") ? "admin" : "member",
    company,
  };
}

export const currentUserQuery = queryOptions({
  queryKey: ["current-user"],
  queryFn: fetchCurrentUser,
  staleTime: 60_000,
});

export function useCurrentUser() {
  return useSuspenseQuery(currentUserQuery).data;
}
