revoke execute on function public.current_company_id() from public, anon;
grant execute on function public.current_company_id() to authenticated;
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;