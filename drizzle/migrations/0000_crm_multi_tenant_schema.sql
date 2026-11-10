-- Enums
create type public.app_role as enum ('admin', 'member');
create type public.client_status as enum ('lead', 'active', 'lost');

-- Companies
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

-- Admin-only company settings (billing notes)
create table public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  billing_notes text not null default '',
  updated_at timestamptz not null default now()
);

-- Profiles (one company per user)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  created_at timestamptz not null default now()
);
create index profiles_company_id_idx on public.profiles(company_id);

-- Roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.app_role not null,
  unique (user_id, role)
);

-- Helper functions
create or replace function public.current_company_id()
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from public.profiles where id = auth.uid()
$$;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

-- Invites (single-use codes)
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 10)),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  used_by uuid references public.profiles(id) on delete set null,
  used_at timestamptz
);
create index invites_company_id_idx on public.invites(company_id);

-- Clients
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  email text not null default '',
  phone text not null default '',
  status public.client_status not null default 'lead',
  notes text not null default '',
  owner_id uuid references public.profiles(id) on delete set null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_company_id_idx on public.clients(company_id);
create index clients_company_status_idx on public.clients(company_id, status);

-- Client documents
create table public.client_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.current_company_id() references public.companies(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint not null default 0,
  mime_type text not null default '',
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index client_documents_client_id_idx on public.client_documents(client_id);

-- Grants
grant select, update (name) on public.companies to authenticated;
grant all on public.companies to service_role;
grant select, update (billing_notes, updated_at) on public.company_settings to authenticated;
grant all on public.company_settings to service_role;
grant select, update (full_name) on public.profiles to authenticated;
grant all on public.profiles to service_role;
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
grant select, insert, delete on public.invites to authenticated;
grant all on public.invites to service_role;
grant select, insert, update, delete on public.clients to authenticated;
grant all on public.clients to service_role;
grant select, insert, delete on public.client_documents to authenticated;
grant all on public.client_documents to service_role;

-- RLS
alter table public.companies enable row level security;
alter table public.company_settings enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.invites enable row level security;
alter table public.clients enable row level security;
alter table public.client_documents enable row level security;

-- companies
create policy "Members view own company" on public.companies
  for select to authenticated using (id = public.current_company_id());
create policy "Admins update own company" on public.companies
  for update to authenticated
  using (id = public.current_company_id() and public.has_role(auth.uid(), 'admin'))
  with check (id = public.current_company_id());

-- company_settings
create policy "Admins view settings" on public.company_settings
  for select to authenticated
  using (company_id = public.current_company_id() and public.has_role(auth.uid(), 'admin'));
create policy "Admins update settings" on public.company_settings
  for update to authenticated
  using (company_id = public.current_company_id() and public.has_role(auth.uid(), 'admin'))
  with check (company_id = public.current_company_id());

-- profiles
create policy "View teammates" on public.profiles
  for select to authenticated using (company_id = public.current_company_id());
create policy "Update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- user_roles
create policy "View teammate roles" on public.user_roles
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = user_roles.user_id and p.company_id = public.current_company_id()
    )
  );

-- invites
create policy "Admins view invites" on public.invites
  for select to authenticated
  using (company_id = public.current_company_id() and public.has_role(auth.uid(), 'admin'));
create policy "Admins create invites" on public.invites
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and public.has_role(auth.uid(), 'admin')
    and created_by = auth.uid()
    and used_by is null and used_at is null
  );
create policy "Admins delete invites" on public.invites
  for delete to authenticated
  using (company_id = public.current_company_id() and public.has_role(auth.uid(), 'admin'));

-- clients
create policy "Team views clients" on public.clients
  for select to authenticated using (company_id = public.current_company_id());
create policy "Team adds clients" on public.clients
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and (owner_id is null or exists (
      select 1 from public.profiles p where p.id = owner_id and p.company_id = public.current_company_id()
    ))
  );
create policy "Team edits clients" on public.clients
  for update to authenticated
  using (company_id = public.current_company_id())
  with check (
    company_id = public.current_company_id()
    and (owner_id is null or exists (
      select 1 from public.profiles p where p.id = owner_id and p.company_id = public.current_company_id()
    ))
  );
create policy "Admins delete clients" on public.clients
  for delete to authenticated
  using (company_id = public.current_company_id() and public.has_role(auth.uid(), 'admin'));

-- client_documents
create policy "Team views documents" on public.client_documents
  for select to authenticated using (company_id = public.current_company_id());
create policy "Team uploads documents" on public.client_documents
  for insert to authenticated
  with check (
    company_id = public.current_company_id()
    and uploaded_by = auth.uid()
    and exists (select 1 from public.clients c where c.id = client_id and c.company_id = public.current_company_id())
    and split_part(storage_path, '/', 1) = public.current_company_id()::text
  );
create policy "Uploader or admin deletes documents" on public.client_documents
  for delete to authenticated
  using (
    company_id = public.current_company_id()
    and (uploaded_by = auth.uid() or public.has_role(auth.uid(), 'admin'))
  );

-- updated_at trigger
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger clients_touch_updated_at before update on public.clients
  for each row execute function public.touch_updated_at();
create trigger company_settings_touch_updated_at before update on public.company_settings
  for each row execute function public.touch_updated_at();

-- Invite lookup for the sign-up form (returns company name for a valid unused code)
create or replace function public.lookup_invite(_code text)
returns text language sql stable security definer set search_path = public as $$
  select c.name from public.invites i
  join public.companies c on c.id = i.company_id
  where i.code = upper(trim(_code)) and i.used_at is null
$$;
revoke all on function public.lookup_invite(text) from public;
grant execute on function public.lookup_invite(text) to anon, authenticated;

-- Sign-up: create a company (admin) or join one with an invite code (member)
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
      where code = _invite_code and used_at is null
      for update;
    if _invite_id is null then
      raise exception 'Invalid or already used invite code';
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Storage policies: files live under <company_id>/<client_id>/...
create policy "Team reads company documents" on storage.objects
  for select to authenticated
  using (bucket_id = 'client-documents' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "Team uploads company documents" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'client-documents' and (storage.foldername(name))[1] = public.current_company_id()::text);
create policy "Uploader or admin deletes company documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'client-documents'
    and (storage.foldername(name))[1] = public.current_company_id()::text
    and (owner = auth.uid() or public.has_role(auth.uid(), 'admin'))
  );