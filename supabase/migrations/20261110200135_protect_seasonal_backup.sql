-- Only authorized owners use this rollback record. Keep public campaign content readable.
-- Rollback: drop the two policies named below. This migration does not rewrite any records.
set local lock_timeout = '5s';

create policy seasonal_backup_signed_out
 on public.site_content as restrictive for select to anon
 using (key <> 'seasonal_backup_v1');

create policy seasonal_backup_owner
 on public.site_content as restrictive for select to authenticated
 using (key <> 'seasonal_backup_v1' or (select public.is_persen_admin()));
