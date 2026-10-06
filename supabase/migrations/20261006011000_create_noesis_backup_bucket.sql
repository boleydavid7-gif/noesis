insert into storage.buckets (id, name, public)
values ('noesis-backups', 'noesis-backups', false)
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Noesis users upload their own backups') then
    create policy "Noesis users upload their own backups"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'noesis-backups' and (storage.foldername(name))[1] = (select auth.uid()::text));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Noesis users read their own backups') then
    create policy "Noesis users read their own backups"
      on storage.objects for select to authenticated
      using (bucket_id = 'noesis-backups' and (storage.foldername(name))[1] = (select auth.uid()::text));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Noesis users update their own backups') then
    create policy "Noesis users update their own backups"
      on storage.objects for update to authenticated
      using (bucket_id = 'noesis-backups' and (storage.foldername(name))[1] = (select auth.uid()::text))
      with check (bucket_id = 'noesis-backups' and (storage.foldername(name))[1] = (select auth.uid()::text));
  end if;
end $$;
