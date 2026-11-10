-- Storage bucket for client documents, as configured on production before 0002_security_hardening
-- (verified with a query on storage.buckets): public = false, file_size_limit = 20971520 (20 MiB),
-- allowed_mime_types = NULL. Seeds run after migrations: when 0002 is present it has already created
-- the bucket with its type filter, so this insert does nothing.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-documents', 'client-documents', false, 20971520, null)
on conflict (id) do nothing;
