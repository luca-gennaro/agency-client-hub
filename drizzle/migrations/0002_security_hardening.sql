-- Security hardening for the findings in AUDIT_NOTES.md (F1, F2, F5, F7, F8).

-- F1 + F2: Supabase's default privileges give anon/authenticated every privilege on new tables,
-- so the column grants in 0000 restricted nothing. Remove table-level writes and grant back only
-- the columns the app writes (src/components/client-form-dialog.tsx, src/routes/_authenticated/*).
revoke insert, update, delete on all tables in schema public from anon, authenticated;

grant update (name) on public.companies to authenticated;
grant update (billing_notes) on public.company_settings to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant insert (created_by) on public.invites to authenticated;
grant delete on public.invites to authenticated;
grant insert (name, email, phone, status, notes, owner_id) on public.clients to authenticated;
grant update (name, email, phone, status, notes, owner_id) on public.clients to authenticated;
grant delete on public.clients to authenticated;
grant insert (client_id, file_name, storage_path, size_bytes, mime_type, uploaded_by)
  on public.client_documents to authenticated;
grant delete on public.client_documents to authenticated;

-- F1 (defence in depth): a profile never changes company, whoever runs the update.
create or replace function public.prevent_profile_company_change()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'profiles.company_id cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.prevent_profile_company_change() from public, anon, authenticated;

create trigger profiles_prevent_company_change before update on public.profiles
  for each row execute function public.prevent_profile_company_change();

-- F8: answer only for the caller or for users of the caller's company.
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = _user_id
      and r.role = _role
      and (
        _user_id = auth.uid()
        or exists (
          select 1 from public.profiles p
          where p.id = _user_id and p.company_id = public.current_company_id()
        )
      )
  )
$$;

-- F7: invites expire after 7 days; the code always comes from the column default (no insert grant).
alter table public.invites
  add column expires_at timestamptz not null default (now() + interval '7 days');

create or replace function public.lookup_invite(_code text)
returns text language sql stable security definer set search_path = public as $$
  select c.name from public.invites i
  join public.companies c on c.id = i.company_id
  where i.code = upper(trim(_code)) and i.used_at is null and i.expires_at > now()
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  _company_id uuid;
  _invite_id uuid;
  _invite_code text := upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')));
  _company_name text := trim(coalesce(new.raw_user_meta_data->>'company_name', ''));
  _full_name text := left(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), 120);
begin
  if _invite_code <> '' then
    select id, company_id into _invite_id, _company_id
      from public.invites
      where code = _invite_code and used_at is null and expires_at > now()
      for update;
    if _invite_id is null then
      raise exception 'Invalid, expired or already used invite code';
    end if;
    insert into public.profiles (id, company_id, full_name, email)
      values (new.id, _company_id, _full_name, coalesce(new.email, ''));
    insert into public.user_roles (user_id, role) values (new.id, 'member');
    update public.invites set used_by = new.id, used_at = now() where id = _invite_id;
  else
    if _company_name = '' then
      _company_name := coalesce(nullif(_full_name, ''), split_part(coalesce(new.email, 'My'), '@', 1)) || '''s agency';
    end if;
    insert into public.companies (name) values (left(_company_name, 120)) returning id into _company_id;
    insert into public.company_settings (company_id) values (_company_id);
    insert into public.profiles (id, company_id, full_name, email)
      values (new.id, _company_id, _full_name, coalesce(new.email, ''));
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  end if;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- F5 (+ F3): the bucket is now defined here with the production settings, plus a type filter
-- matching the upload input's accept attribute (src/routes/_authenticated/clients_.$clientId.tsx).
-- application/octet-stream stays allowed: browsers send it for files whose type they don't know
-- (e.g. .docx on Windows without Office), and it is served as a download, never rendered.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-documents', 'client-documents', false, 20971520,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/x-csv', 'application/csv',
    'text/plain',
    'image/png', 'image/jpeg',
    'application/octet-stream'
  ]
)
on conflict (id) do update set allowed_mime_types = excluded.allowed_mime_types;

-- F5: uploads must go under <company_id>/<id of a client of that company>/...
-- objects.name must be qualified: inside the subquery a bare "name" would resolve to clients.name.
drop policy "Team uploads company documents" on storage.objects;
create policy "Team uploads company documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-documents'
    and (storage.foldername(objects.name))[1] = public.current_company_id()::text
    and exists (
      select 1 from public.clients c
      where c.id::text = (storage.foldername(objects.name))[2]
        and c.company_id = public.current_company_id()
    )
  );
