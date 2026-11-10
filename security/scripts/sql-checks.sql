-- SQL-level checks that the API suite cannot reach. Run by scripts/run.sh after the tests, as the
-- local postgres user, each inside a transaction that is rolled back. Not attack steps: they prove
-- the protections hold even when the incidental ones are gone. Prints OK/UNEXPECTED per check.
\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

select (select id from public.profiles where email like 'user-a-%') as a_id,
       (select company_id from public.profiles where email like 'user-b-%') as b_co,
       (select id from public.profiles where email like 'user-b-%') as b_id \gset

-- F1 demo: the extra "see own profile" policy that made the attack work before 0002.
begin;
create policy "demo: view own profile" on public.profiles for select to authenticated using (id = auth.uid());
select set_config('demo.a', :'a_id', true), set_config('demo.b_co', :'b_co', true),
       set_config('request.jwt.claims', json_build_object('sub', :'a_id', 'role', 'authenticated')::text, true) \g /dev/null
set local role authenticated;
do $$ begin
  update public.profiles set company_id = current_setting('demo.b_co')::uuid where id = current_setting('demo.a')::uuid;
  raise notice 'UNEXPECTED F1 demo (extra SELECT policy, filtered update): succeeded';
exception when others then
  raise notice 'OK F1 demo (extra SELECT policy, filtered update): rejected — % [%]', sqlerrm, sqlstate;
end $$;
do $$ begin
  update public.profiles set company_id = current_setting('demo.b_co')::uuid;
  raise notice 'UNEXPECTED F1 demo (no WHERE): succeeded';
exception when others then
  raise notice 'OK F1 demo (no WHERE): rejected — % [%]', sqlerrm, sqlstate;
end $$;
rollback;

-- F1 trigger: even a role that bypasses grants and RLS cannot move a profile.
begin;
select set_config('demo.a', :'a_id', true), set_config('demo.b_co', :'b_co', true) \g /dev/null
do $$ begin
  update public.profiles set company_id = current_setting('demo.b_co')::uuid where id = current_setting('demo.a')::uuid;
  raise notice 'UNEXPECTED F1 trigger (as postgres): succeeded';
exception when others then
  raise notice 'OK F1 trigger (as postgres): rejected — % [%]', sqlerrm, sqlstate;
end $$;
rollback;

-- F7 expiry: an invite past expires_at is refused by lookup_invite and by the sign-up trigger.
begin;
insert into public.invites (company_id, created_by, expires_at)
  values (:'b_co', :'b_id', now() - interval '1 day') returning code as expired_code \gset
select set_config('demo.code', :'expired_code', true) \g /dev/null
set local role anon;
do $$ begin
  if public.lookup_invite(current_setting('demo.code')) is null then
    raise notice 'OK F7 expiry (lookup_invite as anon): null for an expired code';
  else
    raise notice 'UNEXPECTED F7 expiry (lookup_invite as anon): returned a company';
  end if;
end $$;
reset role;
do $$ begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'expired-invite@security.test', json_build_object('invite_code', current_setting('demo.code'))::jsonb);
  raise notice 'UNEXPECTED F7 expiry (sign-up trigger): user created';
exception when others then
  raise notice 'OK F7 expiry (sign-up trigger): rejected — % [%]', sqlerrm, sqlstate;
end $$;
rollback;
